"""Cost tracking helpers for GPT usage in NeuralChat.

These helpers store daily per-user usage logs in Azure Blob Storage and provide
aggregated summaries for the cost dashboard.
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


# This helper builds the shared memory container used for usage logs and search cache.
def _get_memory_container() -> ContainerClient:
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


# This helper normalizes any token usage shape into the app's standard input/output token dict.
def normalize_usage(raw_usage: Any) -> TokenUsage:
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


# This helper calculates the USD cost for one GPT request from input and output token counts.
def calculate_cost(input_tokens: int, output_tokens: int) -> float:
    input_cost = (max(0, int(input_tokens)) / 1_000_000) * INPUT_COST_PER_MILLION
    output_cost = (max(0, int(output_tokens)) / 1_000_000) * OUTPUT_COST_PER_MILLION
    return round(input_cost + output_cost, 6)


# This helper builds the canonical usage blob path for one user and one day.
def _usage_blob_name(user_id: str, usage_date: str, display_name: str | None = None) -> str:
    return f"usage/{user_segment(user_id, display_name)}/{usage_date}.json"


# This helper finds an existing usage blob for one user/date pair even if the readable name changed.
def _find_existing_usage_blob(container: ContainerClient, user_id: str, usage_date: str) -> str | None:
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


# This helper safely loads a daily usage list and returns an empty list for missing or corrupt blobs.
def get_daily_usage(user_id: str, date: str, display_name: str | None = None) -> list[dict[str, Any]]:
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


# This helper appends one usage record to the current day's blob for the given user.
def log_usage(
    user_id: str,
    feature: str,
    input_tokens: int,
    output_tokens: int,
    display_name: str | None = None,
) -> None:
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


# This helper aggregates the last N days of usage into totals, feature breakdowns, and daily points.
def get_usage_summary(user_id: str, days: int = 30, display_name: str | None = None) -> dict[str, Any]:
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


# This helper checks how much of today's configured daily budget has been used.
def check_daily_limit(user_id: str, daily_limit_usd: float = DEFAULT_DAILY_LIMIT_USD, display_name: str | None = None) -> dict[str, Any]:
    today_date_text = datetime.now(UTC).date().isoformat()
    today_records = get_daily_usage(user_id, today_date_text, display_name)
    today_cost_usd = round(sum(float(record.get("cost_usd", 0.0) or 0.0) for record in today_records), 6)
    normalized_limit = float(daily_limit_usd) if daily_limit_usd and float(daily_limit_usd) > 0 else DEFAULT_DAILY_LIMIT_USD
    percentage_used = round((today_cost_usd / normalized_limit) * 100, 2) if normalized_limit > 0 else 0.0
    return {
        "today_cost_usd": today_cost_usd,
        "daily_limit_usd": round(normalized_limit, 2),
        "limit_exceeded": today_cost_usd > normalized_limit,
        "percentage_used": percentage_used,
    }


# This helper reads the current daily limit from a user profile object and falls back safely.
def resolve_daily_limit(profile: dict[str, Any] | None) -> float:
    raw_value = (profile or {}).get("daily_limit_usd")
    try:
        parsed_value = float(raw_value)
    except (TypeError, ValueError):
        return DEFAULT_DAILY_LIMIT_USD
    if parsed_value <= 0:
        return DEFAULT_DAILY_LIMIT_USD
    return round(parsed_value, 2)


# This helper returns the UTC date string used by usage blobs and dismissal keys.
def current_utc_date_text() -> str:
    return datetime.now(UTC).date().isoformat()
