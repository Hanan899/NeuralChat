"""Agent planning, execution, and history helpers powered by LangChain and LangGraph."""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
import asyncio
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, AsyncIterator, Optional, TypedDict

from azure.core.exceptions import ResourceExistsError, ResourceNotFoundError
from azure.storage.blob import BlobServiceClient, ContainerClient
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import AzureChatOpenAI
from langgraph.graph import END, START, StateGraph

from app.services.blob_paths import (
    blob_parts,
    read_blob_text,
    safe_identifier,
    segment_matches_id,
    session_segment,
    user_segment,
    write_json_with_migration,
)
from app.services.cost_tracker import (
    DAILY_LIMIT_BLOCK_MESSAGE,
    MONTHLY_LIMIT_BLOCK_MESSAGE,
    TokenUsage,
    get_usage_status,
    normalize_usage,
    resolve_daily_limit,
    resolve_monthly_limit,
)
from app.services.file_handler import get_relevant_chunks, list_user_files, load_parsed_chunks
from app.services.memory import load_profile
from app.services.search import search_web

LOGGER = logging.getLogger(__name__)
AZURE_OPENAI_API_VERSION_DEFAULT = "2025-01-01-preview"
DEFAULT_AGENTS_CONTAINER = "neurarchat-agents"
MAX_AGENT_STEPS = 6
AGENT_TIMEOUT_SECONDS = 60.0
AVAILABLE_AGENT_TOOLS = ["web_search", "read_file", "memory_recall"]
PLANNER_SYSTEM_PROMPT = (
    "You are a task planner. Break this goal into clear steps. "
    "Available tools: {available_tools}. "
    "IMPORTANT TOOL RULES: "
    "- Only use 'read_file' if the user explicitly mentions an uploaded file or attachment. "
    "  Never invent or assume a filename — if no file was uploaded, do NOT use read_file. "
    "- Only use 'web_search' for questions requiring current or external information. "
    "- Use 'memory_recall' only if the step needs the user's stored preferences. "
    "- Use null for pure reasoning steps that need no external data. "
    "Return JSON only: "
    '{{"plan_id": "uuid", "goal": "str", "steps": ['
    '{{"step_number": 1, "description": "str", "tool": "str or null", "tool_input": "str or null"}}'
    "]}}"
)
REASONING_SYSTEM_PROMPT = (
    "You are NeuralChat Agent. Complete the current reasoning step using the task goal, "
    "current step description, and previous execution results. Return concise plain text only."
)
SUMMARY_SYSTEM_PROMPT = (
    "You are NeuralChat Agent. Write a clear final answer for the user based on the goal and step results. "
    "Be concise, factual, and structured when useful."
)


def _is_usage_limit_message(message: str | None) -> bool:
    return str(message or "").strip() in {DAILY_LIMIT_BLOCK_MESSAGE, MONTHLY_LIMIT_BLOCK_MESSAGE}


async def _enforce_agent_budget(user_id: str, feature: str, display_name: str | None = None) -> None:
    profile = await asyncio.to_thread(load_profile, user_id, display_name)
    usage_status = await asyncio.to_thread(
        get_usage_status,
        user_id,
        resolve_daily_limit(profile),
        resolve_monthly_limit(profile),
        feature,
        display_name,
    )
    if usage_status["blocked"]:
        raise RuntimeError(str(usage_status["blocking_message"]))


# AgentState TypedDict — defines all keys carried through the LangGraph state machine.
# total=False means nodes only need to return the keys they actually changed.
class AgentState(TypedDict, total=False):
    plan: dict
    total_steps: int
    user_id: str
    display_name: Optional[str]
    session_id: str
    session_title: Optional[str]
    current_step_index: int
    execution_log: list
    stop_execution: bool
    warning_message: Optional[str]
    last_event: Optional[dict]
    started_at: float


# This helper builds the Azure Blob container used for storing agent plans and execution logs.
def _get_agents_container() -> ContainerClient:
    connection_string = (
        os.getenv("AZURE_STORAGE_CONNECTION_STRING", "").strip()
        or os.getenv("AzureWebJobsStorage", "").strip()
    )
    if not connection_string:
        raise RuntimeError("AZURE_STORAGE_CONNECTION_STRING or AzureWebJobsStorage is required.")

    container_name = os.getenv("AZURE_BLOB_AGENTS_CONTAINER", DEFAULT_AGENTS_CONTAINER).strip() or DEFAULT_AGENTS_CONTAINER
    blob_service_client = BlobServiceClient.from_connection_string(connection_string)
    container_client = blob_service_client.get_container_client(container_name)
    try:
        container_client.create_container()
    except ResourceExistsError:
        pass
    return container_client


# This helper builds the blob path for one saved agent plan.
def _plan_blob_name(
    user_id: str,
    plan_id: str,
    display_name: str | None = None,
    session_id: str | None = None,
    session_title: str | None = None,
) -> str:
    if session_id:
        return f"{user_segment(user_id, display_name)}/{session_segment(session_id, session_title)}/plans/{safe_identifier(plan_id)}.json"
    return f"{user_segment(user_id, display_name)}/plans/{safe_identifier(plan_id)}.json"


# This helper builds the blob path for one saved execution log.
def _log_blob_name(
    user_id: str,
    plan_id: str,
    display_name: str | None = None,
    session_id: str | None = None,
    session_title: str | None = None,
) -> str:
    if session_id:
        return f"{user_segment(user_id, display_name)}/{session_segment(session_id, session_title)}/logs/{safe_identifier(plan_id)}.json"
    return f"{user_segment(user_id, display_name)}/logs/{safe_identifier(plan_id)}.json"


# This helper checks whether an agent blob belongs to the target user and optionally session.
def _matches_agent_blob(blob_name: str, user_id: str, plan_id: str | None = None) -> bool:
    parts = blob_parts(blob_name)
    if len(parts) < 3:
        return False
    if not segment_matches_id(parts[0], user_id):
        return False
    if plan_id is None:
        return True
    return Path(parts[-1]).stem == safe_identifier(plan_id)


# This helper finds an existing plan blob in either old or new naming formats.
def _find_existing_plan_blob(agents_container: ContainerClient, user_id: str, plan_id: str) -> str | None:
    legacy_blob_name = f"{safe_identifier(user_id)}/plans/{safe_identifier(plan_id)}.json"
    if read_blob_text(agents_container, legacy_blob_name) is not None:
        return legacy_blob_name

    for blob_item in agents_container.list_blobs():
        blob_name = str(getattr(blob_item, "name", "")).strip()
        parts = blob_parts(blob_name)
        if not blob_name or not _matches_agent_blob(blob_name, user_id, plan_id):
            continue
        if "plans" not in parts:
            continue
        return blob_name
    return None


# This helper finds an existing execution log blob in either old or new naming formats.
def _find_existing_log_blob(agents_container: ContainerClient, user_id: str, plan_id: str) -> str | None:
    legacy_blob_name = f"{safe_identifier(user_id)}/logs/{safe_identifier(plan_id)}.json"
    if read_blob_text(agents_container, legacy_blob_name) is not None:
        return legacy_blob_name

    for blob_item in agents_container.list_blobs():
        blob_name = str(getattr(blob_item, "name", "")).strip()
        parts = blob_parts(blob_name)
        if not blob_name or not _matches_agent_blob(blob_name, user_id, plan_id):
            continue
        if "logs" not in parts:
            continue
        return blob_name
    return None


# This helper extracts plain text from LangChain message content values.
def _extract_message_text(content_value: Any) -> str:
    if isinstance(content_value, str):
        return content_value.strip()

    if isinstance(content_value, list):
        text_parts: list[str] = []
        for content_item in content_value:
            if isinstance(content_item, str) and content_item.strip():
                text_parts.append(content_item.strip())
                continue
            if isinstance(content_item, dict):
                text_value = content_item.get("text")
                if isinstance(text_value, str) and text_value.strip():
                    text_parts.append(text_value.strip())
        return " ".join(text_parts).strip()

    return str(content_value or "").strip()


# This helper extracts token usage from LangChain response objects into the shared app format.
def _extract_response_usage(response_object: Any) -> TokenUsage:
    return normalize_usage(response_object)


# This helper returns a configured LangChain AzureChatOpenAI model for agent planning and reasoning.
def _get_agent_model(temperature: float = 0.0, max_tokens: int | None = None) -> AzureChatOpenAI:
    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "").strip()
    api_key = os.getenv("AZURE_OPENAI_API_KEY", "").strip()
    deployment_name = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", "").strip()
    api_version = os.getenv("AZURE_OPENAI_API_VERSION", AZURE_OPENAI_API_VERSION_DEFAULT).strip()

    if not endpoint or not api_key or not deployment_name:
        raise RuntimeError(
            "Azure OpenAI is not configured. Set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, and AZURE_OPENAI_DEPLOYMENT_NAME."
        )

    return AzureChatOpenAI(
        azure_endpoint=endpoint,
        api_key=api_key,
        azure_deployment=deployment_name,
        api_version=api_version,
        temperature=temperature,
        max_tokens=max_tokens,
    )


# This helper normalizes planner output into the exact persisted plan shape used by the app.
def _normalize_plan(user_goal: str, raw_plan: Any) -> dict[str, Any]:
    normalized_plan_id = str(uuid.uuid4())
    steps_payload: list[dict[str, Any]] = []

    if isinstance(raw_plan, dict):
        candidate_plan_id = str(raw_plan.get("plan_id", "")).strip()
        if candidate_plan_id:
            normalized_plan_id = candidate_plan_id

        normalized_goal = str(raw_plan.get("goal", user_goal)).strip() or user_goal
        raw_steps = raw_plan.get("steps", [])
        if isinstance(raw_steps, list):
            for step_index, raw_step in enumerate(raw_steps[:MAX_AGENT_STEPS], start=1):
                if not isinstance(raw_step, dict):
                    continue
                description = str(raw_step.get("description", "")).strip()
                if not description:
                    continue
                tool_value = raw_step.get("tool")
                normalized_tool = str(tool_value).strip() if isinstance(tool_value, str) and tool_value.strip() else None
                if normalized_tool not in {*AVAILABLE_AGENT_TOOLS, None}:
                    normalized_tool = None
                tool_input_value = raw_step.get("tool_input")
                normalized_tool_input = (
                    str(tool_input_value).strip() if isinstance(tool_input_value, str) and str(tool_input_value).strip() else None
                )
                steps_payload.append(
                    {
                        "step_number": step_index,
                        "description": description,
                        "tool": normalized_tool,
                        "tool_input": normalized_tool_input,
                    }
                )
        else:
            normalized_goal = user_goal
    else:
        normalized_goal = user_goal

    if not steps_payload:
        steps_payload = [
            {
                "step_number": 1,
                "description": "Reason through the goal and produce a complete answer.",
                "tool": None,
                "tool_input": user_goal.strip() or None,
            }
        ]

    return {
        "plan_id": normalized_plan_id,
        "goal": normalized_goal,
        "created_at": datetime.now(UTC).isoformat(),
        "steps": steps_payload,
    }


# This helper renders Tavily results into concise plain text for one completed agent step.
def _format_search_step_result(results: list[dict[str, str]]) -> str:
    if not results:
        return "No web search results found."

    lines: list[str] = []
    for index, result_item in enumerate(results, start=1):
        title = result_item.get("title", "").strip() or "Untitled"
        url = result_item.get("url", "").strip()
        snippet = result_item.get("snippet", "").strip()
        line = f"{index}. {title}"
        if url:
            line += f" ({url})"
        if snippet:
            line += f" - {snippet}"
        lines.append(line)
    return "\n".join(lines)


# This helper loads parsed session files and returns the most relevant text for the current agent step.
def _read_session_file_context(
    user_id: str,
    session_id: str,
    step: dict[str, Any],
    display_name: str | None = None,
    session_title: str | None = None,
) -> str:
    requested_filename = str(step.get("tool_input") or "").strip()
    search_text = requested_filename or str(step.get("description") or "").strip()

    if requested_filename:
        parsed_chunks = load_parsed_chunks(user_id, session_id, requested_filename, display_name, session_title)
        if not parsed_chunks:
            raise ValueError(f"No parsed content found for file '{requested_filename}'.")
        relevant_chunks = get_relevant_chunks(parsed_chunks, search_text, max_chunks=3)
        return f"File: {requested_filename}\n" + "\n\n".join(relevant_chunks)

    session_files = list_user_files(user_id, session_id, display_name, session_title)
    if not session_files:
        raise ValueError("No uploaded files are available in this chat session.")

    all_chunks: list[str] = []
    for session_file in session_files:
        filename = str(session_file.get("filename", "")).strip()
        if not filename:
            continue
        parsed_chunks = load_parsed_chunks(user_id, session_id, filename, display_name, session_title)
        if parsed_chunks:
            all_chunks.extend(parsed_chunks)

    if not all_chunks:
        raise ValueError("Uploaded files were found, but no parsed content is available yet.")

    relevant_chunks = get_relevant_chunks(all_chunks, search_text, max_chunks=3)
    return "Relevant file context:\n" + "\n\n".join(relevant_chunks)


# This helper runs one reasoning-only GPT call for steps that do not use an external tool.
async def _run_reasoning_step_with_usage(
    goal: str,
    step: dict[str, Any],
    execution_log: list[dict[str, Any]],
    user_id: str,
    display_name: str | None = None,
) -> tuple[str, TokenUsage]:
    await _enforce_agent_budget(user_id, "agent_step", display_name)
    model = _get_agent_model(temperature=0.1, max_tokens=500)
    previous_results = execution_log[-4:]
    prompt_text = (
        f"Goal: {goal}\n"
        f"Current step: {step.get('description', '')}\n"
        f"Tool input: {step.get('tool_input') or '(none)'}\n"
        f"Previous results: {json.dumps(previous_results, ensure_ascii=True)}\n"
        "Return the result for this step only."
    )

    # COST NOTE: This reasoning call uses GPT-5 once for steps without external tools.
    response = await model.ainvoke(
        [
            SystemMessage(content=REASONING_SYSTEM_PROMPT),
            HumanMessage(content=prompt_text),
        ]
    )
    return _extract_message_text(response.content), _extract_response_usage(response)


# This helper keeps the older reasoning-step interface for call sites that do not need usage details.
async def _run_reasoning_step(goal: str, step: dict[str, Any], execution_log: list[dict[str, Any]], user_id: str, display_name: str | None = None) -> str:
    result_text, _usage = await _run_reasoning_step_with_usage(goal, step, execution_log, user_id, display_name)
    return result_text


# This function creates a step-by-step task plan from a user goal using LangChain and returns usage too.
async def create_task_plan_with_usage(user_goal: str, available_tools: list[str]) -> tuple[dict[str, Any], TokenUsage]:
    model = _get_agent_model(temperature=0.0, max_tokens=500)
    prompt_text = (
        PLANNER_SYSTEM_PROMPT.format(available_tools=", ".join(available_tools))
        + "\n\n"
        + f"Goal: {user_goal}\nKeep the plan under 6 steps."
    )

    try:
        # COST NOTE: This planning call happens once per agent task and is capped to keep step count small.
        response = await model.ainvoke(
            [
                SystemMessage(content="Return valid JSON only."),
                HumanMessage(content=prompt_text),
            ]
        )
        raw_text = _extract_message_text(response.content)
        raw_plan = json.loads(raw_text)
        usage = _extract_response_usage(response)
    except Exception:
        raw_plan = {"goal": user_goal, "steps": []}
        usage = {"input_tokens": 0, "output_tokens": 0}

    return _normalize_plan(user_goal, raw_plan), usage


# This function keeps the older plan-only interface for call sites that do not need usage details.
async def create_task_plan(user_goal: str, available_tools: list[str]) -> dict[str, Any]:
    plan, _usage = await create_task_plan_with_usage(user_goal, available_tools)
    return plan


# This function saves one agent plan JSON document into blob storage.
def save_task_plan(
    user_id: str,
    plan: dict[str, Any],
    display_name: str | None = None,
    session_id: str | None = None,
    session_title: str | None = None,
) -> None:
    agents_container = _get_agents_container()
    plan_id = str(plan.get("plan_id", "")).strip()
    if not plan_id:
        raise ValueError("plan_id is required to save an agent plan.")
    payload = dict(plan)
    payload["user_id"] = user_id
    payload["display_name"] = display_name or payload.get("display_name") or user_id
    if session_id:
        payload["session_id"] = session_id
        payload["session_title"] = session_title or payload.get("session_title") or session_id
    write_json_with_migration(
        agents_container,
        _plan_blob_name(user_id, plan_id, display_name, session_id, session_title),
        payload,
        old_blob_name=_find_existing_plan_blob(agents_container, user_id, plan_id),
    )


# This function loads one saved plan and safely returns None when the blob does not exist.
def load_task_plan(
    user_id: str,
    plan_id: str,
    display_name: str | None = None,
    session_id: str | None = None,
    session_title: str | None = None,
) -> dict[str, Any] | None:
    agents_container = _get_agents_container()
    existing_blob_name = _find_existing_plan_blob(agents_container, user_id, plan_id)
    if existing_blob_name is None:
        return None
    raw_plan = read_blob_text(agents_container, existing_blob_name)
    if raw_plan is None:
        return None

    try:
        parsed_plan = json.loads(raw_plan)
    except json.JSONDecodeError:
        return None

    if isinstance(parsed_plan, dict):
        parsed_plan.setdefault("user_id", user_id)
        parsed_plan.setdefault("display_name", display_name or user_id)
        resolved_session_id = str(parsed_plan.get("session_id", "")).strip() or session_id
        resolved_session_title = str(parsed_plan.get("session_title", "")).strip() or session_title
        if resolved_session_id:
            parsed_plan["session_id"] = resolved_session_id
            parsed_plan["session_title"] = resolved_session_title or resolved_session_id
            target_blob_name = _plan_blob_name(
                user_id,
                plan_id,
                display_name or parsed_plan.get("display_name"),
                resolved_session_id,
                resolved_session_title,
            )
            if existing_blob_name != target_blob_name:
                write_json_with_migration(agents_container, target_blob_name, parsed_plan, old_blob_name=existing_blob_name)
        return parsed_plan
    return None


# This function executes one planned step and always returns a structured result instead of raising.
async def execute_step(
    step: dict[str, Any],
    user_id: str,
    session_id: str,
    goal: str = "",
    execution_log: list[dict[str, Any]] | None = None,
    display_name: str | None = None,
    session_title: str | None = None,
) -> dict[str, Any]:
    execution_log = execution_log or []
    step_number = int(step.get("step_number", 0) or 0)
    description = str(step.get("description", "")).strip()
    tool = step.get("tool") if step.get("tool") in AVAILABLE_AGENT_TOOLS else None
    tool_input = str(step.get("tool_input") or "").strip() or None

    try:
        if tool == "web_search":
            search_query = tool_input or description
            results = await asyncio.to_thread(search_web, search_query)
            return {
                "step_number": step_number,
                "description": description,
                "tool": tool,
                "tool_input": search_query,
                "result": _format_search_step_result(results),
                "status": "done",
                "error": None,
            }

        if tool == "read_file":
            try:
                file_result = await asyncio.to_thread(
                    _read_session_file_context, user_id, session_id, step, display_name, session_title
                )
                return {
                    "step_number": step_number,
                    "description": description,
                    "tool": tool,
                    "tool_input": tool_input,
                    "result": file_result,
                    "status": "done",
                    "error": None,
                }
            except ValueError:
                # No uploaded file found — fall back to reasoning so the step still completes.
                LOGGER.warning(
                    "read_file tool found no file for step %s — falling back to reasoning.", step_number
                )
                reasoning_result, reasoning_usage = await _run_reasoning_step_with_usage(
                    goal=goal,
                    step=step,
                    execution_log=execution_log,
                    user_id=user_id,
                    display_name=display_name,
                )
                return {
                    "step_number": step_number,
                    "description": description,
                    "tool": None,
                    "tool_input": tool_input,
                    "result": reasoning_result or "No file was available; reasoned through the step instead.",
                    "status": "done",
                    "error": None,
                    "usage": reasoning_usage,
                }

        if tool == "memory_recall":
            profile = await asyncio.to_thread(load_profile, user_id, display_name)
            memory_text = json.dumps(profile, ensure_ascii=True) if profile else "No stored memory found for this user."
            return {
                "step_number": step_number,
                "description": description,
                "tool": tool,
                "tool_input": tool_input,
                "result": memory_text,
                "status": "done",
                "error": None,
            }

        reasoning_result, reasoning_usage = await _run_reasoning_step_with_usage(
            goal=goal,
            step=step,
            execution_log=execution_log,
            user_id=user_id,
            display_name=display_name,
        )
        return {
            "step_number": step_number,
            "description": description,
            "tool": None,
            "tool_input": tool_input,
            "result": reasoning_result or "No reasoning output returned.",
            "status": "done",
            "error": None,
            "usage": reasoning_usage,
        }
    except Exception as execution_error:
        return {
            "step_number": step_number,
            "description": description,
            "tool": tool,
            "tool_input": tool_input,
            "result": "",
            "status": "failed",
            "error": str(execution_error),
        }


# This function saves the full execution log for one completed or partial agent run.
def save_execution_log(
    user_id: str,
    plan_id: str,
    log: list[dict[str, Any]],
    display_name: str | None = None,
    session_id: str | None = None,
    session_title: str | None = None,
) -> None:
    agents_container = _get_agents_container()
    payload = {
        "plan_id": plan_id,
        "user_id": user_id,
        "display_name": display_name or user_id,
        "updated_at": datetime.now(UTC).isoformat(),
        "log": log,
    }
    if session_id:
        payload["session_id"] = session_id
        payload["session_title"] = session_title or session_id
    write_json_with_migration(
        agents_container,
        _log_blob_name(user_id, plan_id, display_name, session_id, session_title),
        payload,
        old_blob_name=_find_existing_log_blob(agents_container, user_id, plan_id),
    )


# This function loads one saved execution log and returns an empty list when no log is found.
def load_execution_log(
    user_id: str,
    plan_id: str,
    display_name: str | None = None,
    session_id: str | None = None,
    session_title: str | None = None,
) -> list[dict[str, Any]]:
    agents_container = _get_agents_container()
    existing_blob_name = _find_existing_log_blob(agents_container, user_id, plan_id)
    if existing_blob_name is None:
        return []
    raw_log = read_blob_text(agents_container, existing_blob_name)
    if raw_log is None:
        return []

    try:
        parsed_log = json.loads(raw_log)
    except json.JSONDecodeError:
        return []

    if isinstance(parsed_log, dict) and isinstance(parsed_log.get("log"), list):
        resolved_session_id = str(parsed_log.get("session_id", "")).strip() or session_id
        resolved_session_title = str(parsed_log.get("session_title", "")).strip() or session_title
        if resolved_session_id:
            parsed_log["session_id"] = resolved_session_id
            parsed_log["session_title"] = resolved_session_title or resolved_session_id
            target_blob_name = _log_blob_name(
                user_id,
                plan_id,
                display_name or parsed_log.get("display_name"),
                resolved_session_id,
                resolved_session_title,
            )
            if existing_blob_name != target_blob_name:
                write_json_with_migration(agents_container, target_blob_name, parsed_log, old_blob_name=existing_blob_name)
        return [entry for entry in parsed_log["log"] if isinstance(entry, dict)]
    return []


# This function lists saved plans for one user so the frontend can render task history.
def list_task_plans(user_id: str) -> list[dict[str, Any]]:
    agents_container = _get_agents_container()
    tasks: list[dict[str, Any]] = []

    for blob_item in agents_container.list_blobs():
        blob_name = str(getattr(blob_item, "name", "")).strip()
        parts = blob_parts(blob_name)
        if not blob_name or not _matches_agent_blob(blob_name, user_id):
            continue
        if "plans" not in parts:
            continue
        plan_id = Path(blob_name).stem
        plan = load_task_plan(user_id, plan_id)
        if not plan:
            continue
        tasks.append(
            {
                "plan_id": plan.get("plan_id", plan_id),
                "goal": str(plan.get("goal", "")).strip(),
                "created_at": str(plan.get("created_at", "")).strip(),
                "steps_count": len(plan.get("steps", [])) if isinstance(plan.get("steps"), list) else 0,
            }
        )

    tasks.sort(key=lambda task: task.get("created_at", ""), reverse=True)
    return tasks


# This function deletes all plan and execution-log blobs linked to one user/session pair.
def delete_session_agent_artifacts(user_id: str, session_id: str) -> dict[str, int]:
    agents_container = _get_agents_container()
    deleted_plans = 0
    deleted_logs = 0
    deleted_blob_names: set[str] = set()

    for blob_item in agents_container.list_blobs():
        blob_name = str(getattr(blob_item, "name", "")).strip()
        if not blob_name or blob_name in deleted_blob_names or not _matches_agent_blob(blob_name, user_id):
            continue

        raw_payload = read_blob_text(agents_container, blob_name)
        if raw_payload is None:
            continue

        try:
            parsed_payload = json.loads(raw_payload)
        except json.JSONDecodeError:
            continue

        if not isinstance(parsed_payload, dict):
            continue

        payload_session_id = str(parsed_payload.get("session_id", "")).strip()
        if payload_session_id != session_id:
            continue

        try:
            agents_container.get_blob_client(blob=blob_name).delete_blob(delete_snapshots="include")
            deleted_blob_names.add(blob_name)
        except ResourceNotFoundError:
            continue

        parts = blob_parts(blob_name)
        if "plans" in parts:
            deleted_plans += 1
        elif "logs" in parts:
            deleted_logs += 1

    return {
        "plans_deleted": deleted_plans,
        "logs_deleted": deleted_logs,
    }


# This function detects repeated same-tool same-input patterns so the agent can stop infinite loops.
def check_for_loop(execution_log: list[dict[str, Any]], max_repeated_tool_calls: int = 3) -> bool:
    if len(execution_log) < max_repeated_tool_calls:
        return False

    recent_entries = execution_log[-max_repeated_tool_calls:]
    first_tool = recent_entries[0].get("tool")
    first_input = recent_entries[0].get("tool_input")

    if not first_tool:
        return False

    for entry in recent_entries[1:]:
        if entry.get("tool") != first_tool or entry.get("tool_input") != first_input:
            return False

    return True


# This function builds the final user-facing summary from the goal and all step results.
async def build_final_summary_with_usage(
    goal: str,
    execution_log: list[dict[str, Any]],
    user_id: str,
    display_name: str | None = None,
) -> tuple[str, TokenUsage]:
    await _enforce_agent_budget(user_id, "agent_summary", display_name)
    model = _get_agent_model(temperature=0.1, max_tokens=1000)
    prompt_text = (
        f"Goal: {goal}\n"
        f"Execution log: {json.dumps(execution_log, ensure_ascii=True)}\n"
        "Write the final answer for the user."
    )

    # COST NOTE: This summary call runs once per finished agent task.
    response = await model.ainvoke(
        [
            SystemMessage(content=SUMMARY_SYSTEM_PROMPT),
            HumanMessage(content=prompt_text),
        ]
    )
    return _extract_message_text(response.content), _extract_response_usage(response)


# This function keeps the older summary-only interface for call sites that do not need usage details.
async def build_final_summary(goal: str, execution_log: list[dict[str, Any]], user_id: str, display_name: str | None = None) -> str:
    summary_text, _usage = await build_final_summary_with_usage(goal, execution_log, user_id, display_name)
    return summary_text


# This helper builds the LangGraph state machine used for sequential agent execution.
# FIX: Every node explicitly passes through ALL fields needed by downstream nodes because
# LangGraph with stream_mode="updates" only delivers the partial dict returned by the
# previous node — it does NOT automatically carry the full initial graph_state forward.
def _build_agent_graph() -> Any:
    graph_builder = StateGraph(AgentState)

    async def step_start_node(state: AgentState) -> dict[str, Any]:
        plan = state.get("plan") or {}
        steps = plan.get("steps", [])
        current_step_index = state.get("current_step_index", 0)

        # Always pass through all identity + timing fields so downstream nodes have them.
        passthrough = {
            "plan": plan,
            "user_id": state.get("user_id"),
            "session_id": state.get("session_id"),
            "display_name": state.get("display_name"),
            "session_title": state.get("session_title"),
            "started_at": state.get("started_at"),
            "total_steps": state.get("total_steps"),
            "execution_log": state.get("execution_log", []),
            "current_step_index": current_step_index,
            "stop_execution": state.get("stop_execution", False),
            "warning_message": state.get("warning_message"),
        }

        if current_step_index >= len(steps):
            return {
                **passthrough,
                "last_event": {
                    "type": "warning",
                    "message": "No remaining steps to start.",
                },
            }

        current_step = steps[current_step_index]
        return {
            **passthrough,
            "last_event": {
                "type": "step_start",
                "step_number": current_step["step_number"],
                "description": current_step["description"],
            },
        }

    async def step_execute_node(state: AgentState) -> dict[str, Any]:
        plan = state.get("plan") or {}
        steps = plan.get("steps", [])
        current_step_index = state.get("current_step_index", 0)
        execution_log = state.get("execution_log") or []

        # Always pass through all identity + timing fields so loop_guard_node has them.
        passthrough = {
            "plan": plan,
            "user_id": state.get("user_id"),
            "session_id": state.get("session_id"),
            "display_name": state.get("display_name"),
            "session_title": state.get("session_title"),
            "started_at": state.get("started_at"),
            "total_steps": state.get("total_steps"),
            "stop_execution": state.get("stop_execution", False),
            "warning_message": state.get("warning_message"),
        }

        if current_step_index >= len(steps):
            return {
                **passthrough,
                "execution_log": execution_log,
                "current_step_index": current_step_index,
                "last_event": {
                    "type": "warning",
                    "message": "No remaining steps to execute.",
                },
            }

        current_step = steps[current_step_index]
        result = await execute_step(
            current_step,
            user_id=state["user_id"],
            session_id=state["session_id"],
            goal=str(plan.get("goal", "")),
            execution_log=execution_log,
            display_name=state.get("display_name"),
            session_title=state.get("session_title"),
        )
        usage_limit_hit = _is_usage_limit_message(result.get("error"))

        return {
            **passthrough,
            "execution_log": execution_log + [result],
            "current_step_index": current_step_index + 1,
            "stop_execution": usage_limit_hit,
            "warning_message": result.get("error") if usage_limit_hit else passthrough.get("warning_message"),
            "last_event": {
                "type": "step_done",
                "step_number": result["step_number"],
                "result": result["result"] or result.get("error") or "",
                "status": result["status"],
                "error": result.get("error"),
                "usage": result.get("usage", {"input_tokens": 0, "output_tokens": 0}),
            },
        }

    async def loop_guard_node(state: AgentState) -> dict[str, Any]:
        # Safe subtraction: fall back to 0 elapsed if started_at is somehow None.
        started_at = state.get("started_at")
        elapsed_seconds = (time.perf_counter() - started_at) if started_at is not None else 0.0

        total_steps = state.get("total_steps") or len((state.get("plan") or {}).get("steps", []))

        # Pass through all fields so step_start_node (next loop iteration) has them.
        return_base: dict[str, Any] = {
            "plan": state.get("plan"),
            "user_id": state.get("user_id"),
            "session_id": state.get("session_id"),
            "display_name": state.get("display_name"),
            "session_title": state.get("session_title"),
            "started_at": started_at,
            "total_steps": total_steps,
            "current_step_index": state.get("current_step_index", 0),
            "execution_log": state.get("execution_log", []),
        }

        if state.get("stop_execution") and _is_usage_limit_message(state.get("warning_message")):
            return {
                **return_base,
                "stop_execution": True,
                "warning_message": state.get("warning_message"),
                "last_event": {
                    "type": "warning",
                    "message": str(state.get("warning_message") or ""),
                },
            }

        if elapsed_seconds >= AGENT_TIMEOUT_SECONDS:
            return {
                **return_base,
                "stop_execution": True,
                "warning_message": f"Agent timed out after {int(AGENT_TIMEOUT_SECONDS)} seconds.",
                "last_event": {
                    "type": "warning",
                    "message": f"Agent timed out after {int(AGENT_TIMEOUT_SECONDS)} seconds.",
                },
            }

        if check_for_loop(state.get("execution_log") or []):
            return {
                **return_base,
                "stop_execution": True,
                "warning_message": "Agent stopped: repeated tool calls detected.",
                "last_event": {
                    "type": "warning",
                    "message": "Agent stopped: repeated tool calls detected.",
                },
            }

        return {
            **return_base,
            "stop_execution": False,
            "warning_message": state.get("warning_message"),
            "last_event": None,
        }

    graph_builder.add_node("step_start", step_start_node)
    graph_builder.add_node("step_execute", step_execute_node)
    graph_builder.add_node("loop_guard", loop_guard_node)
    graph_builder.add_edge(START, "step_start")
    graph_builder.add_edge("step_start", "step_execute")
    graph_builder.add_edge("step_execute", "loop_guard")

    def route_after_loop_guard(state: AgentState) -> str:
        if state.get("stop_execution"):
            return END
        if state.get("current_step_index", 0) >= state.get("total_steps", 0):
            return END
        return "step_start"

    graph_builder.add_conditional_edges("loop_guard", route_after_loop_guard, {"step_start": "step_start", END: END})
    return graph_builder.compile()


# This function runs the compiled LangGraph and yields streamed progress events for the API layer.
async def stream_agent_execution(
    plan: dict[str, Any],
    user_id: str,
    session_id: str,
    display_name: str | None = None,
    session_title: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    compiled_graph = _build_agent_graph()
    plan_steps = plan.get("steps", [])

    if not isinstance(plan_steps, list) or len(plan_steps) == 0:
        fallback_log = [
            {
                "step_number": 1,
                "description": "Reason through the goal and produce a complete answer.",
                "tool": None,
                "tool_input": plan.get("goal", ""),
                "result": "The planner returned no executable steps. NeuralChat used a fallback reasoning step instead.",
                "status": "done",
                "error": None,
            }
        ]
        try:
            fallback_summary, fallback_summary_usage = await build_final_summary_with_usage(
                plan.get("goal", ""),
                fallback_log,
                user_id,
                display_name,
            )
            fallback_warning_message = "The planner returned no valid steps, so NeuralChat used a fallback reasoning step."
        except RuntimeError as budget_error:
            fallback_summary = str(budget_error)
            fallback_summary_usage = {"input_tokens": 0, "output_tokens": 0}
            fallback_warning_message = str(budget_error)
        yield {
            "type": "final_state",
            "plan": {
                **plan,
                "steps": [
                    {
                        "step_number": 1,
                        "description": "Reason through the goal and produce a complete answer.",
                        "tool": None,
                        "tool_input": plan.get("goal", ""),
                    }
                ],
            },
            "execution_log": fallback_log,
            "warning_message": fallback_warning_message,
            "summary": fallback_summary,
            "summary_usage": fallback_summary_usage,
        }
        return

    graph_state: AgentState = {
        "plan": plan,
        "total_steps": len(plan.get("steps", [])),
        "user_id": user_id,
        "display_name": display_name,
        "session_id": session_id,
        "session_title": session_title,
        "current_step_index": 0,
        "execution_log": [],
        "stop_execution": False,
        "warning_message": None,
        "last_event": None,
        "started_at": time.perf_counter(),
    }

    async for update in compiled_graph.astream(graph_state, stream_mode="updates"):
        for partial_state in update.values():
            if not isinstance(partial_state, dict):
                continue
            last_event = partial_state.get("last_event")
            if isinstance(last_event, dict) and last_event.get("type"):
                yield last_event
            graph_state.update(partial_state)

    final_summary = ""
    final_summary_usage: TokenUsage = {"input_tokens": 0, "output_tokens": 0}
    if graph_state.get("warning_message") == f"Agent timed out after {int(AGENT_TIMEOUT_SECONDS)} seconds.":
        final_summary = (
            f"Agent timed out after {int(AGENT_TIMEOUT_SECONDS)} seconds. "
            f"Completed {len(graph_state.get('execution_log', []))} step(s) before stopping."
        )
    elif _is_usage_limit_message(graph_state.get("warning_message")):
        final_summary = str(graph_state.get("warning_message") or "")
    else:
        try:
            final_summary, final_summary_usage = await build_final_summary_with_usage(
                plan.get("goal", ""),
                graph_state.get("execution_log", []),
                user_id,
                display_name,
            )
        except RuntimeError as budget_error:
            final_summary = str(budget_error)
            graph_state["warning_message"] = str(budget_error)

    yield {
        "type": "final_state",
        "plan": plan,
        "execution_log": graph_state.get("execution_log", []),
        "warning_message": graph_state.get("warning_message"),
        "summary": final_summary,
        "summary_usage": final_summary_usage,
    }
