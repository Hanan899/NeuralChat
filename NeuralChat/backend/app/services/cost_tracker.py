"""Cost tracking helpers for GPT usage in NeuralChat.

These helpers store daily per-user usage logs in Azure Blob Storage and provide
aggregated summaries, warning state, and budget enforcement decisions.
"""

from __future__ import annotations

import json
import os
from datetime import UTC, date, datetime, timedelta
from typing import Any, TypedDict

from azure.core.exceptions import ResourceExistsError
from azure.storage.blob import BlobServiceClient, ContainerClient

from app.services.blob_paths import blob_parts, read_blob_text, segment_matches_id, user_segment, write_json_with_migration

INPUT_COST_PER_MILLION = 3.00
OUTPUT_COST_PER_MILLION = 15.00
DEFAULT_DAILY_LIMIT_USD = 1.00
DEFAULT_MONTHLY_LIMIT_USD = 30.00
WARNING_THRESHOLD_PERCENT = 80.0
DAILY_LIMIT_BLOCK_MESSAGE = "You've hit your daily usage limit. To get more access now, send a request to your admin or try again tomorrow"
MONTHLY_LIMIT_BLOCK_MESSAGE = "You've hit your monthly usage limit. To get more access now, send a request to your admin or try again next month"
FEATURE_USAGE_RESERVES_USD: dict[str, float] = {
    "chat": 0.003,
    "agent_plan": 0.002,
    "agent_step": 0.003,
    "agent_summary": 0.003,
    "memory": 0.001,
    "title_generation": 0.001,
    "search_decision": 0.001,
}
USAGE_FEATURES = (
    "chat",
    "memory",
    "search_decision",
    "agent_plan",
    "agent_step",
    "agent_summary",
    "title_generation",
)


class TokenUsage(TypedDict):
    input_tokens: int
    output_tokens: int


def _get_memory_container() -> ContainerClient:
    """Build the shared memory container used for usage logs and search cache."""
    connection_string = (
        os.getenv("AZURE_STORAGE_CONNECTION_STRING", "").strip()
        or os.getenv("AzureWebJobsStorage", "").strip()
    )
    if not connection_string:
        raise RuntimeError("AZURE_STORAGE_CONNECTION_STRING or AzureWebJobsStorage is required.")

    container_name = os.getenv("AZURE_BLOB_MEMORY_CONTAINER", "neurarchat-memory").strip() or "neurarchat-memory"
    blob_service_client = BlobServiceClient.from_connection_string(connection_string)
    container_client = blob_service_client.get_container_client(container_name)
    try:
        container_client.create_container()
    except ResourceExistsError:
        pass
    return container_client


def normalize_usage(raw_usage: Any) -> TokenUsage:
    """Normalize any token usage payload into the app's input/output token shape."""
    if raw_usage is None:
        return {"input_tokens": 0, "output_tokens": 0}

    if isinstance(raw_usage, dict):
        input_tokens = raw_usage.get("input_tokens")
        if input_tokens is None:
            input_tokens = raw_usage.get("prompt_tokens")
        output_tokens = raw_usage.get("output_tokens")
        if output_tokens is None:
            output_tokens = raw_usage.get("completion_tokens")
        if output_tokens is None:
            output_tokens = raw_usage.get("output_token_count")
        if input_tokens is None:
            input_tokens = raw_usage.get("input_token_count")
        return {
            "input_tokens": max(0, int(input_tokens or 0)),
            "output_tokens": max(0, int(output_tokens or 0)),
        }

    usage_metadata = getattr(raw_usage, "usage_metadata", None)
    if isinstance(usage_metadata, dict):
        return normalize_usage(usage_metadata)

    response_metadata = getattr(raw_usage, "response_metadata", None)
    if isinstance(response_metadata, dict):
        token_usage = response_metadata.get("token_usage")
        if token_usage is not None:
            return normalize_usage(token_usage)

    prompt_tokens = getattr(raw_usage, "prompt_tokens", None)
    completion_tokens = getattr(raw_usage, "completion_tokens", None)
    if prompt_tokens is not None or completion_tokens is not None:
        return {
            "input_tokens": max(0, int(prompt_tokens or 0)),
            "output_tokens": max(0, int(completion_tokens or 0)),
        }

    return {"input_tokens": 0, "output_tokens": 0}


def calculate_cost(input_tokens: int, output_tokens: int) -> float:
    """Calculate USD cost for one GPT request from input and output token counts."""
    input_cost = (max(0, int(input_tokens)) / 1_000_000) * INPUT_COST_PER_MILLION
    output_cost = (max(0, int(output_tokens)) / 1_000_000) * OUTPUT_COST_PER_MILLION
    return round(input_cost + output_cost, 6)


def _usage_blob_name(user_id: str, usage_date: str, display_name: str | None = None) -> str:
    """Build the canonical usage blob path for one user and one day."""
    return f"usage/{user_segment(user_id, display_name)}/{usage_date}.json"


def _find_existing_usage_blob(container: ContainerClient, user_id: str, usage_date: str) -> str | None:
    """Find an existing usage blob even if the readable name changed over time."""
    legacy_blob_name = f"usage/{user_id}/{usage_date}.json"
    if read_blob_text(container, legacy_blob_name) is not None:
        return legacy_blob_name

    for blob_item in container.list_blobs(name_starts_with="usage/"):
        blob_name = str(getattr(blob_item, "name", "")).strip()
        parts = blob_parts(blob_name)
        if len(parts) != 3 or parts[0] != "usage":
            continue
        if not segment_matches_id(parts[1], user_id):
            continue
        if parts[2] != f"{usage_date}.json":
            continue
        return blob_name
    return None


def get_daily_usage(user_id: str, date: str, display_name: str | None = None) -> list[dict[str, Any]]:
    """Load one day's usage list and return an empty list for missing or corrupt blobs."""
    usage_container = _get_memory_container()
    existing_blob_name = _find_existing_usage_blob(usage_container, user_id, date)
    if existing_blob_name is None:
        return []

    raw_payload = read_blob_text(usage_container, existing_blob_name)
    if raw_payload is None:
        return []

    try:
        parsed_payload = json.loads(raw_payload)
    except json.JSONDecodeError:
        return []

    if not isinstance(parsed_payload, list):
        return []

    records = [entry for entry in parsed_payload if isinstance(entry, dict)]
    canonical_blob_name = _usage_blob_name(user_id, date, display_name)
    if existing_blob_name != canonical_blob_name:
        write_json_with_migration(usage_container, canonical_blob_name, records, old_blob_name=existing_blob_name)
    return records


def log_usage(
    user_id: str,
    feature: str,
    input_tokens: int,
    output_tokens: int,
    display_name: str | None = None,
) -> None:
    """Append one usage record to the current day's blob for the given user."""
    usage_container = _get_memory_container()
    usage_date = datetime.now(UTC).date().isoformat()
    existing_blob_name = _find_existing_usage_blob(usage_container, user_id, usage_date)
    existing_records: list[dict[str, Any]] = []
    if existing_blob_name is not None:
        existing_records = get_daily_usage(user_id, usage_date, display_name)

    normalized_feature = feature if feature in USAGE_FEATURES else str(feature or "unknown").strip() or "unknown"
    normalized_input_tokens = max(0, int(input_tokens))
    normalized_output_tokens = max(0, int(output_tokens))
    record = {
        "timestamp": datetime.now(UTC).replace(microsecond=0).isoformat(),
        "feature": normalized_feature,
        "input_tokens": normalized_input_tokens,
        "output_tokens": normalized_output_tokens,
        "cost_usd": calculate_cost(normalized_input_tokens, normalized_output_tokens),
    }

    write_json_with_migration(
        usage_container,
        _usage_blob_name(user_id, usage_date, display_name),
        existing_records + [record],
        old_blob_name=existing_blob_name,
    )


def get_usage_summary(user_id: str, days: int = 30, display_name: str | None = None) -> dict[str, Any]:
    """Aggregate the last N days of usage into totals, breakdowns, and daily points."""
    safe_days = max(1, int(days))
    today_date = datetime.now(UTC).date()
    total_cost_usd = 0.0
    total_input_tokens = 0
    total_output_tokens = 0
    by_feature: dict[str, dict[str, Any]] = {
        feature_name: {
            "cost_usd": 0.0,
            "calls": 0,
            "input_tokens": 0,
            "output_tokens": 0,
        }
        for feature_name in USAGE_FEATURES
    }
    daily_costs: list[dict[str, Any]] = []

    for day_offset in range(safe_days - 1, -1, -1):
        current_date = today_date - timedelta(days=day_offset)
        current_date_text = current_date.isoformat()
        day_records = get_daily_usage(user_id, current_date_text, display_name)
        if not day_records:
            daily_costs.append({"date": current_date_text, "cost_usd": 0.0})
            continue

        current_day_cost = 0.0
        for record in day_records:
            record_feature = str(record.get("feature", "")).strip() or "unknown"
            record_input_tokens = max(0, int(record.get("input_tokens", 0) or 0))
            record_output_tokens = max(0, int(record.get("output_tokens", 0) or 0))
            record_cost = float(record.get("cost_usd", calculate_cost(record_input_tokens, record_output_tokens)) or 0.0)

            total_input_tokens += record_input_tokens
            total_output_tokens += record_output_tokens
            total_cost_usd += record_cost
            current_day_cost += record_cost

            if record_feature not in by_feature:
                by_feature[record_feature] = {
                    "cost_usd": 0.0,
                    "calls": 0,
                    "input_tokens": 0,
                    "output_tokens": 0,
                }

            by_feature[record_feature]["cost_usd"] = round(by_feature[record_feature]["cost_usd"] + record_cost, 6)
            by_feature[record_feature]["calls"] += 1
            by_feature[record_feature]["input_tokens"] += record_input_tokens
            by_feature[record_feature]["output_tokens"] += record_output_tokens

        daily_costs.append({"date": current_date_text, "cost_usd": round(current_day_cost, 6)})

    return {
        "total_cost_usd": round(total_cost_usd, 6),
        "total_input_tokens": total_input_tokens,
        "total_output_tokens": total_output_tokens,
        "by_feature": by_feature,
        "daily_costs": daily_costs,
    }


def _resolve_positive_limit(raw_value: Any, default_value: float) -> float:
    """Parse a positive USD limit value and safely fall back when missing or invalid."""
    try:
        parsed_value = float(raw_value)
    except (TypeError, ValueError):
        return round(default_value, 2)
    if parsed_value <= 0:
        return round(default_value, 2)
    return round(parsed_value, 2)


def _sum_usage_cost(records: list[dict[str, Any]]) -> float:
    """Sum usage cost across a daily usage record list."""
    return round(sum(float(record.get("cost_usd", 0.0) or 0.0) for record in records), 6)


def _build_limit_window_summary(spent_usd: float, limit_usd: float) -> dict[str, Any]:
    """Build a common summary payload for one budget window."""
    normalized_limit = _resolve_positive_limit(limit_usd, DEFAULT_DAILY_LIMIT_USD)
    safe_spent = round(max(0.0, float(spent_usd or 0.0)), 6)
    remaining_usd = round(max(normalized_limit - safe_spent, 0.0), 6)
    percentage_used = round((safe_spent / normalized_limit) * 100, 2) if normalized_limit > 0 else 0.0
    limit_exceeded = safe_spent >= normalized_limit
    warning_triggered = percentage_used >= WARNING_THRESHOLD_PERCENT
    return {
        "spent_usd": safe_spent,
        "limit_usd": normalized_limit,
        "remaining_usd": remaining_usd,
        "percentage_used": percentage_used,
        "warning_triggered": warning_triggered,
        "limit_exceeded": limit_exceeded,
    }


def check_daily_limit(
    user_id: str,
    daily_limit_usd: float = DEFAULT_DAILY_LIMIT_USD,
    display_name: str | None = None,
) -> dict[str, Any]:
    """Check how much of today's configured daily budget has been used."""
    today_date_text = datetime.now(UTC).date().isoformat()
    today_records = get_daily_usage(user_id, today_date_text, display_name)
    today_cost_usd = _sum_usage_cost(today_records)
    summary = _build_limit_window_summary(today_cost_usd, _resolve_positive_limit(daily_limit_usd, DEFAULT_DAILY_LIMIT_USD))
    return {
        "today_cost_usd": summary["spent_usd"],
        "daily_limit_usd": summary["limit_usd"],
        "remaining_usd": summary["remaining_usd"],
        "warning_triggered": summary["warning_triggered"],
        "limit_exceeded": summary["limit_exceeded"],
        "percentage_used": summary["percentage_used"],
        "spent_usd": summary["spent_usd"],
        "limit_usd": summary["limit_usd"],
    }


def get_monthly_usage_total(user_id: str, display_name: str | None = None, today: date | None = None) -> float:
    """Sum usage for the current UTC month from day one through today."""
    current_day = today or datetime.now(UTC).date()
    month_start = current_day.replace(day=1)
    total_cost_usd = 0.0
    cursor = month_start
    while cursor <= current_day:
        total_cost_usd += _sum_usage_cost(get_daily_usage(user_id, cursor.isoformat(), display_name))
        cursor += timedelta(days=1)
    return round(total_cost_usd, 6)


def check_monthly_limit(
    user_id: str,
    monthly_limit_usd: float = DEFAULT_MONTHLY_LIMIT_USD,
    display_name: str | None = None,
) -> dict[str, Any]:
    """Check how much of the current monthly budget has been used so far."""
    month_cost_usd = get_monthly_usage_total(user_id, display_name)
    return _build_limit_window_summary(month_cost_usd, _resolve_positive_limit(monthly_limit_usd, DEFAULT_MONTHLY_LIMIT_USD))


def resolve_daily_limit(profile: dict[str, Any] | None) -> float:
    """Read the current daily limit from a user profile object and fall back safely."""
    return _resolve_positive_limit((profile or {}).get("daily_limit_usd"), DEFAULT_DAILY_LIMIT_USD)


def resolve_monthly_limit(profile: dict[str, Any] | None) -> float:
    """Read the current monthly limit from a user profile object and fall back safely."""
    return _resolve_positive_limit((profile or {}).get("monthly_limit_usd"), DEFAULT_MONTHLY_LIMIT_USD)


def get_feature_reserve_usd(feature: str) -> float:
    """Return the strict reserve threshold used to gate a feature before spending."""
    return round(float(FEATURE_USAGE_RESERVES_USD.get(feature, FEATURE_USAGE_RESERVES_USD["chat"])), 6)


def get_usage_status(
    user_id: str,
    daily_limit_usd: float = DEFAULT_DAILY_LIMIT_USD,
    monthly_limit_usd: float = DEFAULT_MONTHLY_LIMIT_USD,
    feature: str = "chat",
    display_name: str | None = None,
) -> dict[str, Any]:
    """Build the combined daily/monthly enforcement payload for one feature."""
    daily_summary = check_daily_limit(user_id, daily_limit_usd, display_name)
    monthly_summary = check_monthly_limit(user_id, monthly_limit_usd, display_name)
    reserve_usd = get_feature_reserve_usd(feature)

    blocking_period: str | None = None
    blocking_message = ""
    if daily_summary["remaining_usd"] < reserve_usd:
        blocking_period = "daily"
        blocking_message = DAILY_LIMIT_BLOCK_MESSAGE
    elif monthly_summary["remaining_usd"] < reserve_usd:
        blocking_period = "monthly"
        blocking_message = MONTHLY_LIMIT_BLOCK_MESSAGE

    return {
        "daily": _build_limit_window_summary(daily_summary["today_cost_usd"], daily_summary["daily_limit_usd"]),
        "monthly": monthly_summary,
        "blocked": blocking_period is not None,
        "blocking_period": blocking_period,
        "blocking_message": blocking_message,
    }


def current_utc_date_text() -> str:
    """Return the UTC date string used by usage blobs and dismissal keys."""
    return datetime.now(UTC).date().isoformat()
