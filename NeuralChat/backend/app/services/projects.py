"""Project workspace helpers for project metadata, chats, memory, and files.

These helpers keep project data separate from global chat and profile data while
following the same readable blob naming approach used elsewhere in NeuralChat.
"""

from __future__ import annotations

import asyncio
import json
import os
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import httpx
from azure.core.exceptions import ResourceExistsError, ResourceNotFoundError
from azure.storage.blob import BlobServiceClient, ContainerClient

from app.services.blob_paths import (
    blob_parts,
    project_segment,
    read_blob_text,
    segment_matches_id,
    session_segment,
    user_segment,
    write_json_with_migration,
)
from app.services.cost_tracker import TokenUsage, log_usage, normalize_usage
from app.services.file_handler import (
    _get_parsed_container,
    _get_uploads_container,
    _safe_filename,
    chunk_text,
    get_relevant_chunks,
    parse_file,
    validate_file,
)
from app.services.titles import sanitize_conversation_title

AZURE_OPENAI_API_VERSION_DEFAULT = "2025-01-01-preview"
ALLOWED_PROJECT_UPDATE_FIELDS = {"name", "description", "emoji", "color", "pinned", "system_prompt"}
PROJECT_HIDDEN_MEMORY_FIELDS = {"updated_at", "last_updated", "_raw_facts"}
BRAIN_LOG_MAX_ENTRIES = 100

PROJECT_TEMPLATES: dict[str, dict[str, Any]] = {
    "startup": {
        "emoji": "🚀",
        "color": "#6366f1",
        "label": "Startup Builder",
        "description": "Build, plan, and grow your startup",
        "system_prompt": (
            "You are a dedicated startup advisor for this project. "
            "You know everything about this specific startup - its name, "
            "tech stack, target users, and business model from our conversations. "
            "Give strategic, actionable advice. Never confuse this project "
            "with anything outside it. Be direct and founder-focused."
        ),
        "memory_keys": ["startup_name", "tech_stack", "target_users", "business_model", "stage"],
    },
    "study": {
        "emoji": "📚",
        "color": "#10b981",
        "label": "Study Assistant",
        "description": "Master any subject or skill",
        "system_prompt": (
            "You are a dedicated study assistant for this project. "
            "You track what the user has already learned, what confuses them, "
            "and what they need to study next. Always build on previous lessons. "
            "Use simple language. Give examples. Test understanding with questions."
        ),
        "memory_keys": ["subject", "current_level", "topics_covered", "weak_areas", "learning_goal"],
    },
    "code": {
        "emoji": "💻",
        "color": "#3b82f6",
        "label": "Code Reviewer",
        "description": "Review and improve code quality",
        "system_prompt": (
            "You are a senior software engineer dedicated to this codebase project. "
            "You remember the tech stack, architecture decisions, and past code reviews. "
            "Be precise, opinionated, and thorough. Point out bugs, anti-patterns, "
            "and improvements. Always explain why a change is better."
        ),
        "memory_keys": ["language", "framework", "project_type", "coding_style", "known_issues"],
    },
    "writing": {
        "emoji": "✍️",
        "color": "#f59e0b",
        "label": "Writing Partner",
        "description": "Write, edit, and improve documents",
        "system_prompt": (
            "You are a dedicated writing partner for this project. "
            "You remember the document type, target audience, tone, and writing style. "
            "Help draft, edit, restructure, and improve writing. "
            "Be specific in feedback. Never rewrite everything - improve what exists."
        ),
        "memory_keys": ["document_type", "target_audience", "tone", "writing_style", "current_draft_stage"],
    },
    "research": {
        "emoji": "🔍",
        "color": "#8b5cf6",
        "label": "Research Hub",
        "description": "Research, summarize, and organize topics",
        "system_prompt": (
            "You are a dedicated research analyst for this project. "
            "You remember what has already been researched, key findings, "
            "and what still needs investigation. Always cite sources when searching. "
            "Summarize clearly. Highlight contradictions in findings."
        ),
        "memory_keys": ["research_topic", "key_findings", "sources_reviewed", "open_questions", "research_goal"],
    },
    "job": {
        "emoji": "💼",
        "color": "#ec4899",
        "label": "Job Search",
        "description": "Plan and execute your job search",
        "system_prompt": (
            "You are a dedicated career coach for this job search project. "
            "You know the user's target role, skills, experience, and applications. "
            "Help with resumes, cover letters, interview prep, and strategy. "
            "Be encouraging but realistic. Track what has been applied to."
        ),
        "memory_keys": ["target_role", "skills", "experience_level", "companies_applied", "interview_stage"],
    },
    "custom": {
        "emoji": "✨",
        "color": "#6b7280",
        "label": "Custom Project",
        "description": "Build your own custom workspace",
        "system_prompt": (
            "You are a dedicated AI assistant for this project. "
            "Learn everything relevant about this project from conversations. "
            "Stay focused on this project context only."
        ),
        "memory_keys": [],
    },
}


# This helper opens the shared memory container used for project metadata, memory, and chats.
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


# This helper returns the canonical index blob path for one user's project list.
def _project_index_blob_name(user_id: str, display_name: str | None = None) -> str:
    return f"projects/{user_segment(user_id, display_name)}/index.json"


# This helper returns the canonical readable project segment for one project.
def _project_folder_segment(project_id: str, project_name: str | None) -> str:
    return project_segment(project_id, project_name)


# This helper builds the canonical prefix for one project root.
def _project_prefix(user_id: str, project_id: str, project_name: str | None, display_name: str | None = None) -> str:
    return f"projects/{user_segment(user_id, display_name)}/{_project_folder_segment(project_id, project_name)}"


# This helper builds the metadata blob name for one project.
def _project_meta_blob_name(user_id: str, project_id: str, project_name: str | None, display_name: str | None = None) -> str:
    return f"{_project_prefix(user_id, project_id, project_name, display_name)}/meta.json"


# This helper builds the project memory blob name for one project.
def _project_memory_blob_name(user_id: str, project_id: str, project_name: str | None, display_name: str | None = None) -> str:
    return f"{_project_prefix(user_id, project_id, project_name, display_name)}/memory.json"


# This helper builds the project brain log blob name for one project.
def _project_brain_log_blob_name(user_id: str, project_id: str, project_name: str | None, display_name: str | None = None) -> str:
    return f"{_project_prefix(user_id, project_id, project_name, display_name)}/brain_log.json"


# This helper builds the canonical project chat blob name.
def _project_chat_blob_name(
    user_id: str,
    project_id: str,
    project_name: str | None,
    session_id: str,
    session_title: str | None = None,
    display_name: str | None = None,
) -> str:
    return f"{_project_prefix(user_id, project_id, project_name, display_name)}/chats/{session_segment(session_id, session_title)}.json"


# This helper builds the canonical raw project file blob name.
def _project_file_blob_name(
    user_id: str,
    project_id: str,
    project_name: str | None,
    filename: str,
    display_name: str | None = None,
) -> str:
    return f"{_project_prefix(user_id, project_id, project_name, display_name)}/files/{_safe_filename(filename)}"


# This helper builds the canonical parsed project file blob name.
def _project_parsed_blob_name(
    user_id: str,
    project_id: str,
    project_name: str | None,
    filename: str,
    display_name: str | None = None,
) -> str:
    return f"{_project_prefix(user_id, project_id, project_name, display_name)}/files_parsed/{_safe_filename(filename)}.json"


# This helper reads one blob as raw bytes and returns None when it does not exist.
def _read_blob_bytes(container: ContainerClient, blob_name: str) -> bytes | None:
    blob_client = container.get_blob_client(blob=blob_name)
    try:
        return blob_client.download_blob().readall()
    except ResourceNotFoundError:
        return None


# This helper finds the existing user folder segment for one user in the projects tree.
def _find_existing_user_segment(container: ContainerClient, user_id: str) -> str | None:
    for blob_item in container.list_blobs(name_starts_with="projects/"):
        parts = blob_parts(str(getattr(blob_item, "name", "")).strip())
        if len(parts) < 2 or parts[0] != "projects":
            continue
        if segment_matches_id(parts[1], user_id):
            return parts[1]
    return None


# This helper finds the existing readable folder segment for a project id.
def _find_existing_project_segment(container: ContainerClient, user_id: str, project_id: str) -> str | None:
    existing_user_segment = _find_existing_user_segment(container, user_id)
    if not existing_user_segment:
        return None
    project_root_prefix = f"projects/{existing_user_segment}/"
    for blob_item in container.list_blobs(name_starts_with=project_root_prefix):
        parts = blob_parts(str(getattr(blob_item, "name", "")).strip())
        if len(parts) < 3 or parts[0] != "projects":
            continue
        if not segment_matches_id(parts[1], user_id):
            continue
        if segment_matches_id(parts[2], project_id):
            return parts[2]
    return None


# This helper finds the existing chat blob name for one project chat id.
def _find_existing_project_chat_blob(container: ContainerClient, user_id: str, project_id: str, session_id: str) -> str | None:
    existing_project_segment = _find_existing_project_segment(container, user_id, project_id)
    if not existing_project_segment:
        return None

    existing_user_segment = _find_existing_user_segment(container, user_id)
    if not existing_user_segment:
        return None

    prefix = f"projects/{existing_user_segment}/{existing_project_segment}/chats/"
    for blob_item in container.list_blobs(name_starts_with=prefix):
        blob_name = str(getattr(blob_item, "name", "")).strip()
        parts = blob_parts(blob_name)
        if len(parts) != 5:
            continue
        session_stem = parts[4].removesuffix(".json")
        if segment_matches_id(session_stem, session_id):
            return blob_name
    return None


# This helper loads the full project index and returns an empty list when none exists.
def _load_project_index(user_id: str, display_name: str | None = None) -> list[dict[str, Any]]:
    memory_container = _get_memory_container()
    canonical_blob_name = _project_index_blob_name(user_id, display_name)
    existing_user_segment = _find_existing_user_segment(memory_container, user_id)
    existing_blob_name = f"projects/{existing_user_segment}/index.json" if existing_user_segment else None
    if existing_blob_name is None:
        return []

    raw_payload = read_blob_text(memory_container, existing_blob_name)
    if raw_payload is None:
        return []

    try:
        parsed_payload = json.loads(raw_payload)
    except json.JSONDecodeError:
        return []

    if not isinstance(parsed_payload, list):
        return []

    projects = [project for project in parsed_payload if isinstance(project, dict)]
    if existing_blob_name != canonical_blob_name:
        write_json_with_migration(memory_container, canonical_blob_name, projects, old_blob_name=existing_blob_name)
    return projects


# This helper writes the full project index back to blob storage.
def _write_project_index(user_id: str, projects: list[dict[str, Any]], display_name: str | None = None) -> None:
    memory_container = _get_memory_container()
    existing_user_segment = _find_existing_user_segment(memory_container, user_id)
    existing_blob_name = f"projects/{existing_user_segment}/index.json" if existing_user_segment else None
    write_json_with_migration(
        memory_container,
        _project_index_blob_name(user_id, display_name),
        projects,
        old_blob_name=existing_blob_name,
    )


# This helper sorts projects so pinned items appear first and newer updates appear next.
def _sort_projects(projects: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        projects,
        key=lambda project: (
            bool(project.get("pinned", False)),
            str(project.get("updated_at", "")),
        ),
        reverse=True,
    )


# This helper copies every blob from one project prefix into another project prefix.
def _migrate_project_prefix_in_container(container: ContainerClient, old_prefix: str, new_prefix: str) -> None:
    if old_prefix == new_prefix:
        return

    for blob_item in list(container.list_blobs(name_starts_with=old_prefix)):
        old_blob_name = str(getattr(blob_item, "name", "")).strip()
        if not old_blob_name:
            continue
        raw_payload = _read_blob_bytes(container, old_blob_name)
        if raw_payload is None:
            continue
        new_blob_name = f"{new_prefix}{old_blob_name.removeprefix(old_prefix)}"
        container.get_blob_client(blob=new_blob_name).upload_blob(raw_payload, overwrite=True)
        try:
            container.get_blob_client(blob=old_blob_name).delete_blob(delete_snapshots="include")
        except ResourceNotFoundError:
            continue


# This helper returns the current UTC timestamp string without microseconds.
def _timestamp_text() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


# This helper turns one memory key into a readable label for prompts and suggestions.
def _memory_key_label(memory_key: str) -> str:
    return memory_key.replace("_", " ").strip()


# This helper normalizes one fact value into a compact string for storage and prompts.
def _normalize_fact_value(raw_value: Any) -> str | None:
    if raw_value is None:
        return None
    if isinstance(raw_value, str):
        normalized_value = raw_value.strip()
        return normalized_value or None
    if isinstance(raw_value, bool):
        return "true" if raw_value else "false"
    if isinstance(raw_value, (int, float)):
        return str(raw_value)
    if isinstance(raw_value, (list, dict)):
        try:
            serialized_value = json.dumps(raw_value, ensure_ascii=True)
        except TypeError:
            return None
        return serialized_value.strip() or None
    return str(raw_value).strip() or None


# This helper converts a stored session segment into a readable fallback title.
def _session_segment_fallback_title(session_segment_value: str) -> str:
    readable_value = str(session_segment_value).split("__")[0].strip()
    if not readable_value or readable_value == "chat":
        return ""
    words = [word for word in readable_value.replace("_", "-").split("-") if word]
    return " ".join(word.upper() if len(word) <= 3 else word.capitalize() for word in words).strip()


# This helper resolves the best available project chat title from saved messages and path naming.
def _resolve_project_chat_title(messages: list[dict[str, Any]], session_segment_value: str, project_name: str) -> str:
    normalized_project_name = str(project_name or "").strip().lower()
    for message in messages:
        raw_title = str(message.get("session_title", "")).strip()
        if not raw_title:
            continue
        if raw_title.lower() == normalized_project_name:
            continue
        if raw_title == str(message.get("session_id", "")).strip():
            continue
        return raw_title[:80]

    return _session_segment_fallback_title(session_segment_value) or "Project chat"


# This helper returns only the visible template-relevant memory facts.
def _visible_project_memory(memory: dict[str, Any], template: str) -> dict[str, str]:
    visible_memory: dict[str, str] = {}
    for memory_key in get_template_memory_keys(template):
        normalized_value = _normalize_fact_value(memory.get(memory_key))
        if normalized_value is not None:
            visible_memory[memory_key] = normalized_value
    return visible_memory


# This helper validates a requested template key and returns its template payload.
def _get_template(template_key: str) -> dict[str, Any]:
    template = PROJECT_TEMPLATES.get(str(template_key).strip())
    if template is None:
        raise ValueError("Unknown project template.")
    return template


# This helper loads one project metadata object directly from blob storage.
def _load_project_meta_blob(user_id: str, project_id: str, display_name: str | None = None) -> dict[str, Any] | None:
    memory_container = _get_memory_container()
    existing_project_segment = _find_existing_project_segment(memory_container, user_id, project_id)
    existing_user_segment = _find_existing_user_segment(memory_container, user_id)
    if not existing_project_segment or not existing_user_segment:
        return None

    existing_blob_name = f"projects/{existing_user_segment}/{existing_project_segment}/meta.json"
    raw_payload = read_blob_text(memory_container, existing_blob_name)
    if raw_payload is None:
        return None

    try:
        parsed_payload = json.loads(raw_payload)
    except json.JSONDecodeError:
        return None

    if not isinstance(parsed_payload, dict):
        return None

    canonical_blob_name = _project_meta_blob_name(
        user_id,
        project_id,
        str(parsed_payload.get("name", "")).strip() or None,
        display_name,
    )
    if existing_blob_name != canonical_blob_name:
        write_json_with_migration(memory_container, canonical_blob_name, parsed_payload, old_blob_name=existing_blob_name)
    return parsed_payload


# This helper writes one project metadata object to its canonical path.
def _write_project_meta(project_data: dict[str, Any], display_name: str | None = None) -> None:
    memory_container = _get_memory_container()
    existing_project_segment = _find_existing_project_segment(memory_container, str(project_data["user_id"]), str(project_data["project_id"]))
    existing_user_segment = _find_existing_user_segment(memory_container, str(project_data["user_id"]))
    old_blob_name = None
    if existing_project_segment and existing_user_segment:
        old_blob_name = f"projects/{existing_user_segment}/{existing_project_segment}/meta.json"
    write_json_with_migration(
        memory_container,
        _project_meta_blob_name(
            str(project_data["user_id"]),
            str(project_data["project_id"]),
            str(project_data.get("name", "")).strip() or None,
            display_name,
        ),
        project_data,
        old_blob_name=old_blob_name,
    )


# This helper updates the in-index project entry after a project metadata change.
def _save_project_into_index(user_id: str, project_data: dict[str, Any], display_name: str | None = None) -> None:
    existing_projects = _load_project_index(user_id, display_name)
    next_projects: list[dict[str, Any]] = []
    found_existing = False
    for existing_project in existing_projects:
        if str(existing_project.get("project_id", "")) == str(project_data["project_id"]):
            next_projects.append(project_data)
            found_existing = True
        else:
            next_projects.append(existing_project)
    if not found_existing:
        next_projects.append(project_data)
    _write_project_index(user_id, _sort_projects(next_projects), display_name)


# This helper increments or decrements a project's stored chat count safely.
def _update_project_chat_count(user_id: str, project_id: str, delta: int, display_name: str | None = None) -> None:
    project_data = get_project(user_id, project_id, display_name)
    if project_data is None:
        raise ValueError("Project not found.")

    project_data["chat_count"] = max(0, int(project_data.get("chat_count", 0) or 0) + delta)
    project_data["updated_at"] = _timestamp_text()
    _write_project_meta(project_data, display_name)
    _save_project_into_index(user_id, project_data, display_name)


# This helper returns a copy of the predefined project templates for public API use.
def get_project_templates() -> dict[str, dict[str, Any]]:
    return {template_key: dict(template_value) for template_key, template_value in PROJECT_TEMPLATES.items()}


# This function returns the relevant memory keys for one template and never raises.
def get_template_memory_keys(template: str) -> list[str]:
    template_payload = PROJECT_TEMPLATES.get(str(template).strip())
    if not isinstance(template_payload, dict):
        return []
    memory_keys = template_payload.get("memory_keys", [])
    if not isinstance(memory_keys, list):
        return []
    return [str(memory_key).strip() for memory_key in memory_keys if str(memory_key).strip()]


# This function creates a brand new project for this user and stores both meta and index entries.
def create_project(
    user_id: str,
    name: str,
    template: str,
    description: str = "",
    emoji: str = "",
    color: str = "",
    custom_system_prompt: str = "",
    display_name: str | None = None,
) -> dict[str, Any]:
    clean_name = str(name).strip()
    if not clean_name:
        raise ValueError("Project name is required.")
    if len(clean_name) > 50:
        raise ValueError("Project name must be 50 characters or fewer.")

    template_config = _get_template(template)
    timestamp_text = _timestamp_text()
    project_data = {
        "project_id": str(uuid4()),
        "user_id": user_id,
        "name": clean_name,
        "description": str(description or "").strip(),
        "emoji": str(emoji or "").strip() or template_config["emoji"],
        "template": template,
        "color": str(color or "").strip() or template_config["color"],
        "system_prompt": str(custom_system_prompt or "").strip() or template_config["system_prompt"],
        "created_at": timestamp_text,
        "updated_at": timestamp_text,
        "chat_count": 0,
        "pinned": False,
    }

    memory_container = _get_memory_container()
    write_json_with_migration(
        memory_container,
        _project_meta_blob_name(user_id, project_data["project_id"], clean_name, display_name),
        project_data,
    )
    write_json_with_migration(
        memory_container,
        _project_memory_blob_name(user_id, project_data["project_id"], clean_name, display_name),
        {},
    )

    existing_projects = _load_project_index(user_id, display_name)
    existing_projects.append(project_data)
    _write_project_index(user_id, _sort_projects(existing_projects), display_name)
    return project_data


# This function loads all projects for this user with pinned-first and newest-first ordering.
def get_all_projects(user_id: str, display_name: str | None = None) -> list[dict[str, Any]]:
    return _sort_projects(_load_project_index(user_id, display_name))


# This function loads one project metadata object and returns None when it does not exist.
def get_project(user_id: str, project_id: str, display_name: str | None = None) -> dict[str, Any] | None:
    project_data = _load_project_meta_blob(user_id, project_id, display_name)
    if project_data is not None:
        return project_data

    for indexed_project in _load_project_index(user_id, display_name):
        if str(indexed_project.get("project_id", "")) == str(project_id):
            return indexed_project
    return None


# This function updates the allowed project fields and keeps protected fields unchanged.
def update_project(user_id: str, project_id: str, updates: dict[str, Any], display_name: str | None = None) -> dict[str, Any]:
    project_data = get_project(user_id, project_id, display_name)
    if project_data is None:
        raise ValueError("Project not found.")

    updated_project = dict(project_data)
    old_project_name = str(project_data.get("name", "")).strip() or None
    for field_name, field_value in updates.items():
        if field_name not in ALLOWED_PROJECT_UPDATE_FIELDS:
            continue
        if field_name == "name":
            clean_name = str(field_value or "").strip()
            if not clean_name:
                raise ValueError("Project name is required.")
            if len(clean_name) > 50:
                raise ValueError("Project name must be 50 characters or fewer.")
            updated_project[field_name] = clean_name
            continue
        if field_name == "pinned":
            updated_project[field_name] = bool(field_value)
            continue
        updated_project[field_name] = str(field_value or "").strip()

    updated_project["updated_at"] = _timestamp_text()
    updated_project["user_id"] = user_id
    updated_project["project_id"] = project_id
    updated_project["template"] = project_data.get("template", updated_project.get("template"))

    new_project_name = str(updated_project.get("name", "")).strip() or None
    if old_project_name and new_project_name and old_project_name != new_project_name:
        old_memory_prefix = _project_prefix(user_id, project_id, old_project_name, display_name)
        new_memory_prefix = _project_prefix(user_id, project_id, new_project_name, display_name)
        _migrate_project_prefix_in_container(_get_memory_container(), old_memory_prefix, new_memory_prefix)
        _migrate_project_prefix_in_container(_get_uploads_container(), old_memory_prefix, new_memory_prefix)
        _migrate_project_prefix_in_container(_get_parsed_container(), old_memory_prefix, new_memory_prefix)

    _write_project_meta(updated_project, display_name)
    _save_project_into_index(user_id, updated_project, display_name)
    return updated_project


# This function deletes every blob for a project and removes it from the index.
def delete_project(user_id: str, project_id: str, display_name: str | None = None) -> None:
    project_data = get_project(user_id, project_id, display_name)
    if project_data is None:
        raise ValueError("Project not found.")

    existing_projects = _load_project_index(user_id, display_name)
    next_projects = [project for project in existing_projects if str(project.get("project_id", "")) != project_id]

    for container in (_get_memory_container(), _get_uploads_container(), _get_parsed_container()):
        existing_user_segment = _find_existing_user_segment(container, user_id)
        existing_project_segment = _find_existing_project_segment(container, user_id, project_id)
        if not existing_user_segment or not existing_project_segment:
            continue
        prefix = f"projects/{existing_user_segment}/{existing_project_segment}/"
        for blob_item in list(container.list_blobs(name_starts_with=prefix)):
            blob_name = str(getattr(blob_item, "name", "")).strip()
            if not blob_name:
                continue
            try:
                container.get_blob_client(blob=blob_name).delete_blob(delete_snapshots="include")
            except ResourceNotFoundError:
                continue

    _write_project_index(user_id, _sort_projects(next_projects), display_name)


# This function creates a new empty chat session for one project and returns its session id.
def create_project_chat(user_id: str, project_id: str, display_name: str | None = None) -> str:
    project_data = get_project(user_id, project_id, display_name)
    if project_data is None:
        raise ValueError("Project not found.")

    session_id = str(uuid4())
    memory_container = _get_memory_container()
    write_json_with_migration(
        memory_container,
        _project_chat_blob_name(user_id, project_id, str(project_data.get("name", "")), session_id, None, display_name),
        [],
    )
    _update_project_chat_count(user_id, project_id, 1, display_name)
    return session_id


# This function loads the full message history for one project chat.
def load_project_chat_messages(
    user_id: str,
    project_id: str,
    session_id: str,
    display_name: str | None = None,
    session_title: str | None = None,
) -> list[dict[str, Any]]:
    project_data = get_project(user_id, project_id, display_name)
    if project_data is None:
        return []

    memory_container = _get_memory_container()
    existing_blob_name = _find_existing_project_chat_blob(memory_container, user_id, project_id, session_id)
    if existing_blob_name is None:
        return []

    raw_payload = read_blob_text(memory_container, existing_blob_name)
    if raw_payload is None:
        return []

    try:
        parsed_payload = json.loads(raw_payload)
    except json.JSONDecodeError:
        return []

    if not isinstance(parsed_payload, list):
        return []

    canonical_blob_name = _project_chat_blob_name(
        user_id,
        project_id,
        str(project_data.get("name", "")),
        session_id,
        session_title,
        display_name,
    )
    if existing_blob_name != canonical_blob_name:
        write_json_with_migration(memory_container, canonical_blob_name, parsed_payload, old_blob_name=existing_blob_name)
    return [message for message in parsed_payload if isinstance(message, dict)]


# This function saves the full message history for one project chat.
def save_project_chat_messages(
    user_id: str,
    project_id: str,
    session_id: str,
    messages: list[dict[str, Any]],
    display_name: str | None = None,
    session_title: str | None = None,
) -> None:
    project_data = get_project(user_id, project_id, display_name)
    if project_data is None:
        raise ValueError("Project not found.")

    memory_container = _get_memory_container()
    existing_blob_name = _find_existing_project_chat_blob(memory_container, user_id, project_id, session_id)
    write_json_with_migration(
        memory_container,
        _project_chat_blob_name(user_id, project_id, str(project_data.get("name", "")), session_id, session_title, display_name),
        messages,
        old_blob_name=existing_blob_name,
    )
    _update_project_chat_count(user_id, project_id, 0, display_name)


# This function appends one chat message to an existing project chat transcript.
def append_project_chat_message(
    user_id: str,
    project_id: str,
    session_id: str,
    message: dict[str, Any],
    display_name: str | None = None,
    session_title: str | None = None,
) -> None:
    messages = load_project_chat_messages(user_id, project_id, session_id, display_name, session_title)
    messages.append(message)
    save_project_chat_messages(user_id, project_id, session_id, messages, display_name, session_title)


# This function renames one project chat by updating stored session_title values and canonical blob naming.
def update_project_chat_title(
    user_id: str,
    project_id: str,
    session_id: str,
    title: str,
    display_name: str | None = None,
) -> str:
    clean_title = sanitize_conversation_title(str(title or ""), str(title or ""))
    if not clean_title or clean_title == "New chat":
        raise ValueError("Project chat title must be a meaningful non-empty string.")

    project_data = get_project(user_id, project_id, display_name)
    if project_data is None:
        raise ValueError("Project not found.")

    messages = load_project_chat_messages(user_id, project_id, session_id, display_name)
    if not messages:
        raise ValueError("Project chat not found.")

    renamed_messages: list[dict[str, Any]] = []
    for message in messages:
        renamed_message = dict(message)
        renamed_message["session_title"] = clean_title
        renamed_messages.append(renamed_message)

    save_project_chat_messages(user_id, project_id, session_id, renamed_messages, display_name, clean_title)
    return clean_title


# This function deletes one project chat transcript and updates the chat count.
def delete_project_chat(user_id: str, project_id: str, session_id: str, display_name: str | None = None) -> bool:
    memory_container = _get_memory_container()
    existing_blob_name = _find_existing_project_chat_blob(memory_container, user_id, project_id, session_id)
    if existing_blob_name is None:
        return False
    try:
        memory_container.get_blob_client(blob=existing_blob_name).delete_blob(delete_snapshots="include")
    except ResourceNotFoundError:
        return False
    _update_project_chat_count(user_id, project_id, -1, display_name)
    return True


# This function lists all project chats with message counts and last-message previews.
def get_project_chats(user_id: str, project_id: str, display_name: str | None = None) -> list[dict[str, Any]]:
    project_data = get_project(user_id, project_id, display_name)
    if project_data is None:
        return []

    memory_container = _get_memory_container()
    existing_user_segment = _find_existing_user_segment(memory_container, user_id)
    existing_project_segment = _find_existing_project_segment(memory_container, user_id, project_id)
    if not existing_user_segment or not existing_project_segment:
        return []

    prefix = f"projects/{existing_user_segment}/{existing_project_segment}/chats/"
    chats: list[dict[str, Any]] = []
    for blob_item in memory_container.list_blobs(name_starts_with=prefix):
        blob_name = str(getattr(blob_item, "name", "")).strip()
        if not blob_name.endswith(".json"):
            continue
        parts = blob_parts(blob_name)
        if len(parts) != 5:
            continue
        session_blob_stem = parts[4].removesuffix(".json")
        session_id = session_blob_stem.split("__")[-1]
        messages = load_project_chat_messages(user_id, project_id, session_id, display_name)
        created_at = ""
        last_message_preview = ""
        title = _resolve_project_chat_title(messages, session_blob_stem, str(project_data.get("name", "")))
        if messages:
            created_at = str(messages[0].get("created_at", "")).strip()
            last_message_preview = str(messages[-1].get("content", "")).strip()[:80]
        elif getattr(blob_item, "last_modified", None):
            created_at = blob_item.last_modified.isoformat()
        chats.append(
            {
                "session_id": session_id,
                "title": title,
                "created_at": created_at,
                "message_count": len(messages),
                "last_message_preview": last_message_preview,
            }
        )

    chats.sort(key=lambda chat: str(chat.get("created_at", "")), reverse=True)
    return chats


# This function loads project-specific memory facts and safely returns an empty dict when missing.
def load_project_memory(user_id: str, project_id: str, display_name: str | None = None) -> dict[str, Any]:
    project_data = get_project(user_id, project_id, display_name)
    if project_data is None:
        return {}

    memory_container = _get_memory_container()
    existing_project_segment = _find_existing_project_segment(memory_container, user_id, project_id)
    existing_user_segment = _find_existing_user_segment(memory_container, user_id)
    existing_blob_name = None
    if existing_user_segment and existing_project_segment:
        existing_blob_name = f"projects/{existing_user_segment}/{existing_project_segment}/memory.json"
    if existing_blob_name is None:
        return {}

    raw_payload = read_blob_text(memory_container, existing_blob_name)
    if raw_payload is None:
        return {}

    try:
        parsed_payload = json.loads(raw_payload)
    except json.JSONDecodeError:
        return {}

    if not isinstance(parsed_payload, dict):
        return {}

    canonical_blob_name = _project_memory_blob_name(user_id, project_id, str(project_data.get("name", "")), display_name)
    if existing_blob_name != canonical_blob_name:
        write_json_with_migration(memory_container, canonical_blob_name, parsed_payload, old_blob_name=existing_blob_name)
    return parsed_payload


# This function loads the recent Project Brain log and keeps blob naming migrated.
def get_brain_log(user_id: str, project_id: str, display_name: str | None = None) -> list[dict[str, Any]]:
    project_data = get_project(user_id, project_id, display_name)
    if project_data is None:
        return []

    memory_container = _get_memory_container()
    existing_project_segment = _find_existing_project_segment(memory_container, user_id, project_id)
    existing_user_segment = _find_existing_user_segment(memory_container, user_id)
    existing_blob_name = None
    if existing_user_segment and existing_project_segment:
        existing_blob_name = f"projects/{existing_user_segment}/{existing_project_segment}/brain_log.json"
    if existing_blob_name is None:
        return []

    raw_payload = read_blob_text(memory_container, existing_blob_name)
    if raw_payload is None:
        return []

    try:
        parsed_payload = json.loads(raw_payload)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed_payload, list):
        return []

    canonical_blob_name = _project_brain_log_blob_name(user_id, project_id, str(project_data.get("name", "")), display_name)
    if existing_blob_name != canonical_blob_name:
        write_json_with_migration(memory_container, canonical_blob_name, parsed_payload, old_blob_name=existing_blob_name)
    return [entry for entry in parsed_payload if isinstance(entry, dict)]


# This function records one successful Project Brain learning event.
def log_brain_extraction(
    user_id: str,
    project_id: str,
    session_id: str,
    extracted_facts: dict[str, Any],
    tokens_used: int,
    display_name: str | None = None,
) -> None:
    project_data = get_project(user_id, project_id, display_name)
    if project_data is None:
        raise ValueError("Project not found.")

    if not extracted_facts:
        return

    memory_container = _get_memory_container()
    existing_log = get_brain_log(user_id, project_id, display_name)
    existing_log.append(
        {
            "timestamp": _timestamp_text(),
            "session_id": session_id,
            "extracted_facts": extracted_facts,
            "tokens_used": int(tokens_used),
        }
    )
    trimmed_log = existing_log[-BRAIN_LOG_MAX_ENTRIES:]

    existing_project_segment = _find_existing_project_segment(memory_container, user_id, project_id)
    existing_user_segment = _find_existing_user_segment(memory_container, user_id)
    old_blob_name = None
    if existing_user_segment and existing_project_segment:
        old_blob_name = f"projects/{existing_user_segment}/{existing_project_segment}/brain_log.json"

    write_json_with_migration(
        memory_container,
        _project_brain_log_blob_name(user_id, project_id, str(project_data.get("name", "")), display_name),
        trimmed_log,
        old_blob_name=old_blob_name,
    )


# This function merges new project facts into the project's memory blob and appends an audit trail.
def save_project_memory(user_id: str, project_id: str, facts: dict[str, Any], display_name: str | None = None) -> None:
    project_data = get_project(user_id, project_id, display_name)
    if project_data is None:
        raise ValueError("Project not found.")

    memory_container = _get_memory_container()
    existing_memory = load_project_memory(user_id, project_id, display_name)
    merged_memory = dict(existing_memory)
    raw_facts = existing_memory.get("_raw_facts", [])
    if not isinstance(raw_facts, list):
        raw_facts = []

    timestamp_text = _timestamp_text()
    normalized_facts: dict[str, str] = {}
    for field_name, field_value in facts.items():
        normalized_value = _normalize_fact_value(field_value)
        if normalized_value is None:
            continue
        normalized_facts[field_name] = normalized_value
        merged_memory[field_name] = normalized_value
        raw_facts.append(
            {
                "extracted_at": timestamp_text,
                "fact_key": field_name,
                "fact_value": normalized_value,
                "confidence": "high",
            }
        )

    if not normalized_facts:
        return

    merged_memory["last_updated"] = timestamp_text
    merged_memory["_raw_facts"] = raw_facts

    existing_project_segment = _find_existing_project_segment(memory_container, user_id, project_id)
    existing_user_segment = _find_existing_user_segment(memory_container, user_id)
    old_blob_name = None
    if existing_user_segment and existing_project_segment:
        old_blob_name = f"projects/{existing_user_segment}/{existing_project_segment}/memory.json"

    write_json_with_migration(
        memory_container,
        _project_memory_blob_name(user_id, project_id, str(project_data.get("name", "")), display_name),
        merged_memory,
        old_blob_name=old_blob_name,
    )


# This function clears the project's stored memory facts and brain log history.
def clear_project_memory(user_id: str, project_id: str, display_name: str | None = None) -> None:
    project_data = get_project(user_id, project_id, display_name)
    if project_data is None:
        raise ValueError("Project not found.")

    memory_container = _get_memory_container()
    existing_project_segment = _find_existing_project_segment(memory_container, user_id, project_id)
    existing_user_segment = _find_existing_user_segment(memory_container, user_id)
    old_memory_blob_name = None
    old_brain_log_blob_name = None
    if existing_user_segment and existing_project_segment:
        old_memory_blob_name = f"projects/{existing_user_segment}/{existing_project_segment}/memory.json"
        old_brain_log_blob_name = f"projects/{existing_user_segment}/{existing_project_segment}/brain_log.json"

    write_json_with_migration(
        memory_container,
        _project_memory_blob_name(user_id, project_id, str(project_data.get("name", "")), display_name),
        {},
        old_blob_name=old_memory_blob_name,
    )
    write_json_with_migration(
        memory_container,
        _project_brain_log_blob_name(user_id, project_id, str(project_data.get("name", "")), display_name),
        [],
        old_blob_name=old_brain_log_blob_name,
    )


# This function builds the project system prompt from the template prompt plus known project facts.
def build_project_system_prompt(user_id: str, project_id: str, display_name: str | None = None) -> str:
    project_data = get_project(user_id, project_id, display_name)
    if project_data is None:
        raise ValueError("Project not found.")

    base_system_prompt = str(project_data.get("system_prompt", "")).strip()
    memory_facts = load_project_memory(user_id, project_id, display_name)
    visible_memory = _visible_project_memory(memory_facts, str(project_data.get("template", "custom")))
    if not visible_memory:
        return base_system_prompt
    memory_lines = [f"- {field_name}: {field_value}" for field_name, field_value in visible_memory.items()]
    return f"{base_system_prompt}\n\nWhat I know about this project:\n" + "\n".join(memory_lines)


# This function calculates how complete the current project memory is for one template.
def get_memory_completeness(memory: dict[str, Any], template: str) -> dict[str, Any]:
    memory_keys = get_template_memory_keys(template)
    if template == "custom":
        return {"percentage": 100, "filled_keys": [], "missing_keys": [], "suggestion": ""}
    if not memory_keys:
        return {"percentage": 0, "filled_keys": [], "missing_keys": [], "suggestion": ""}

    visible_memory = _visible_project_memory(memory, template)
    filled_keys = [memory_key for memory_key in memory_keys if memory_key in visible_memory]
    missing_keys = [memory_key for memory_key in memory_keys if memory_key not in visible_memory]
    percentage = int(round((len(filled_keys) / len(memory_keys)) * 100)) if memory_keys else 0

    suggestion = ""
    if missing_keys:
        readable_missing = [_memory_key_label(memory_key) for memory_key in missing_keys[:2]]
        if len(readable_missing) == 1:
            suggestion = f"Tell me about your {readable_missing[0]}."
        else:
            suggestion = f"Tell me about your {readable_missing[0]} and {readable_missing[1]}."

    return {
        "percentage": percentage,
        "filled_keys": filled_keys,
        "missing_keys": missing_keys,
        "suggestion": suggestion,
    }


# This helper extracts plain text from Azure OpenAI message payloads.
def _extract_message_text(message_object: dict[str, Any]) -> str:
    content = message_object.get("content", "")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        text_parts: list[str] = []
        for content_item in content:
            if isinstance(content_item, dict):
                text_value = content_item.get("text")
                if isinstance(text_value, str) and text_value.strip():
                    text_parts.append(text_value.strip())
        return " ".join(text_parts).strip()
    return ""


# This function extracts template-specific project facts from one exchange.
def extract_project_facts(
    message: str,
    reply: str,
    template: str,
    existing_memory: dict[str, Any],
) -> dict[str, Any]:
    extracted_facts, _ = extract_project_facts_with_usage(message, reply, template, existing_memory)
    return extracted_facts


# This function extracts template-specific project facts from one exchange and returns usage data too.
def extract_project_facts_with_usage(
    message: str,
    reply: str,
    template: str,
    existing_memory: dict[str, Any],
) -> tuple[dict[str, Any], TokenUsage]:
    template_config = _get_template(template)
    memory_keys = get_template_memory_keys(template)
    if not memory_keys:
        return {}, {"input_tokens": 0, "output_tokens": 0}

    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "").strip().rstrip("/")
    api_key = os.getenv("AZURE_OPENAI_API_KEY", "").strip()
    deployment_name = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", "").strip()
    if not endpoint or not api_key or not deployment_name:
        return {}, {"input_tokens": 0, "output_tokens": 0}

    request_url = f"{endpoint}/openai/deployments/{deployment_name}/chat/completions"
    query_params = {"api-version": os.getenv("AZURE_OPENAI_API_VERSION", AZURE_OPENAI_API_VERSION_DEFAULT)}
    request_headers = {"api-key": api_key, "content-type": "application/json"}
    request_payload = {
        "messages": [
            {
                "role": "system",
                "content": (
                    f"Extract facts about this {template} project from the conversation.\n"
                    f"Look only for these fields: {', '.join(memory_keys)}.\n"
                    "Return JSON only.\n"
                    "Only include fields where you found clear information.\n"
                    "Return {} if nothing relevant was found.\n"
                    f"Current known facts: {json.dumps(_visible_project_memory(existing_memory, template), ensure_ascii=True)}\n"
                    "Only return new or updated facts. Do not repeat facts that are already known."
                ),
            },
            {
                "role": "user",
                "content": (
                    "Conversation exchange:\n"
                    f"User message: {message}\n"
                    f"Assistant reply: {reply}\n"
                    "Return JSON only."
                ),
            },
        ],
        "temperature": 0,
        "max_tokens": 300,
    }

    try:
        with httpx.Client(timeout=12.0) as http_client:
            response = http_client.post(request_url, params=query_params, json=request_payload, headers=request_headers)
            response.raise_for_status()
            response_data = response.json()
    except Exception:
        return {}, {"input_tokens": 0, "output_tokens": 0}

    usage = normalize_usage(response_data.get("usage"))
    choices = response_data.get("choices", [])
    if not choices:
        return {}, usage

    response_text = _extract_message_text(choices[0].get("message", {}))
    if not response_text:
        return {}, usage

    try:
        parsed_facts = json.loads(response_text)
    except json.JSONDecodeError:
        return {}, usage
    if not isinstance(parsed_facts, dict):
        return {}, usage

    normalized_facts: dict[str, Any] = {}
    for memory_key in memory_keys:
        if memory_key not in parsed_facts:
            continue
        normalized_value = _normalize_fact_value(parsed_facts[memory_key])
        if normalized_value is None:
            continue
        existing_value = _normalize_fact_value(existing_memory.get(memory_key))
        if existing_value == normalized_value:
            continue
        normalized_facts[memory_key] = normalized_value
    return normalized_facts, usage


# This async wrapper keeps backward compatibility for callers still using the older helper name.
async def process_project_memory_update(
    user_id: str,
    project_id: str,
    template_key: str,
    message: str,
    reply: str,
    display_name: str | None = None,
) -> None:
    existing_memory = await asyncio.to_thread(load_project_memory, user_id, project_id, display_name)
    extracted_facts, usage = await asyncio.to_thread(
        extract_project_facts_with_usage,
        message,
        reply,
        template_key,
        existing_memory,
    )
    if usage["input_tokens"] or usage["output_tokens"]:
        await asyncio.to_thread(log_usage, user_id, "memory", usage["input_tokens"], usage["output_tokens"], display_name)
    if not extracted_facts:
        return
    await asyncio.to_thread(save_project_memory, user_id, project_id, extracted_facts, display_name)


# This function uploads a project-scoped file into the shared uploads container.
def upload_project_file(
    user_id: str,
    project_id: str,
    project_name: str,
    filename: str,
    file_bytes: bytes,
    display_name: str | None = None,
) -> str:
    uploads_container = _get_uploads_container()
    blob_name = _project_file_blob_name(user_id, project_id, project_name, filename, display_name)
    uploads_container.get_blob_client(blob=blob_name).upload_blob(file_bytes, overwrite=True)
    return blob_name


# This function stores parsed project file chunks so they can be reused across project chats.
def save_project_parsed_chunks(
    user_id: str,
    project_id: str,
    project_name: str,
    filename: str,
    chunks: list[str],
    display_name: str | None = None,
) -> None:
    parsed_container = _get_parsed_container()
    payload = {
        "filename": _safe_filename(filename),
        "chunk_count": len(chunks),
        "chunks": chunks,
        "user_id": user_id,
        "project_id": project_id,
        "project_name": project_name,
        "display_name": display_name or user_id,
        "parsed_at": _timestamp_text(),
    }
    write_json_with_migration(
        parsed_container,
        _project_parsed_blob_name(user_id, project_id, project_name, filename, display_name),
        payload,
    )


# This function loads parsed project file chunks and returns None when nothing exists yet.
def load_project_parsed_chunks(
    user_id: str,
    project_id: str,
    filename: str,
    display_name: str | None = None,
) -> list[str] | None:
    project_data = get_project(user_id, project_id, display_name)
    if project_data is None:
        return None

    parsed_container = _get_parsed_container()
    existing_user_segment = _find_existing_user_segment(parsed_container, user_id)
    existing_project_segment = _find_existing_project_segment(parsed_container, user_id, project_id)
    if not existing_user_segment or not existing_project_segment:
        return None

    existing_blob_name = f"projects/{existing_user_segment}/{existing_project_segment}/files_parsed/{_safe_filename(filename)}.json"
    raw_payload = read_blob_text(parsed_container, existing_blob_name)
    if raw_payload is None:
        return None

    try:
        parsed_payload = json.loads(raw_payload)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed_payload, dict):
        return None

    chunks = parsed_payload.get("chunks")
    if not isinstance(chunks, list):
        return None
    return [str(chunk).strip() for chunk in chunks if str(chunk).strip()]


# This function lists every project-scoped uploaded file for the workspace.
def list_project_files(user_id: str, project_id: str, display_name: str | None = None) -> list[dict[str, str]]:
    uploads_container = _get_uploads_container()
    existing_user_segment = _find_existing_user_segment(uploads_container, user_id)
    existing_project_segment = _find_existing_project_segment(uploads_container, user_id, project_id)
    if not existing_user_segment or not existing_project_segment:
        return []

    prefix = f"projects/{existing_user_segment}/{existing_project_segment}/files/"
    listed_files: list[dict[str, str]] = []
    for blob_item in uploads_container.list_blobs(name_starts_with=prefix):
        blob_name = str(getattr(blob_item, "name", "")).strip()
        parts = blob_parts(blob_name)
        if len(parts) != 5:
            continue
        uploaded_at_value = getattr(blob_item, "last_modified", None)
        listed_files.append(
            {
                "filename": parts[4],
                "uploaded_at": uploaded_at_value.isoformat() if uploaded_at_value else "",
                "blob_path": blob_name,
            }
        )
    listed_files.sort(key=lambda file_item: file_item.get("uploaded_at", ""), reverse=True)
    return listed_files


# This function deletes one project-scoped file and its parsed companion JSON.
def delete_project_file(user_id: str, project_id: str, filename: str, display_name: str | None = None) -> None:
    project_data = get_project(user_id, project_id, display_name)
    if project_data is None:
        raise ValueError("Project not found.")

    uploads_container = _get_uploads_container()
    parsed_container = _get_parsed_container()
    raw_blob_name = _project_file_blob_name(user_id, project_id, str(project_data.get("name", "")), filename, display_name)
    parsed_blob_name = _project_parsed_blob_name(user_id, project_id, str(project_data.get("name", "")), filename, display_name)

    raw_deleted = False
    try:
        uploads_container.get_blob_client(blob=raw_blob_name).delete_blob(delete_snapshots="include")
        raw_deleted = True
    except ResourceNotFoundError:
        raw_deleted = False

    try:
        parsed_container.get_blob_client(blob=parsed_blob_name).delete_blob(delete_snapshots="include")
    except ResourceNotFoundError:
        pass

    if not raw_deleted:
        raise ValueError(f"File '{filename}' was not found.")


# This function deletes all project-scoped files and parsed chunks for a project.
def delete_all_project_files(user_id: str, project_id: str) -> dict[str, int]:
    deleted_uploads = 0
    deleted_parsed = 0
    for container, kind in ((_get_uploads_container(), "uploads"), (_get_parsed_container(), "parsed")):
        existing_user_segment = _find_existing_user_segment(container, user_id)
        existing_project_segment = _find_existing_project_segment(container, user_id, project_id)
        if not existing_user_segment or not existing_project_segment:
            continue
        prefix = f"projects/{existing_user_segment}/{existing_project_segment}/"
        for blob_item in list(container.list_blobs(name_starts_with=prefix)):
            blob_name = str(getattr(blob_item, "name", "")).strip()
            if not blob_name:
                continue
            try:
                container.get_blob_client(blob=blob_name).delete_blob(delete_snapshots="include")
                if kind == "uploads":
                    deleted_uploads += 1
                else:
                    deleted_parsed += 1
            except ResourceNotFoundError:
                continue
    return {"uploads_deleted": deleted_uploads, "parsed_deleted": deleted_parsed}


# This function returns the most relevant parsed project file chunks for one user question.
def get_project_file_context_chunks(user_id: str, project_id: str, question: str, display_name: str | None = None) -> list[str]:
    all_chunks: list[str] = []
    for project_file in list_project_files(user_id, project_id, display_name):
        file_name = str(project_file.get("filename", "")).strip()
        if not file_name:
            continue
        parsed_chunks = load_project_parsed_chunks(user_id, project_id, file_name, display_name)
        if parsed_chunks:
            all_chunks.extend(parsed_chunks)
    return get_relevant_chunks(all_chunks, question, 3)


# This function handles project-scoped upload + parse work and returns file metadata.
def process_project_upload(
    user_id: str,
    project_id: str,
    filename: str,
    file_bytes: bytes,
    display_name: str | None = None,
) -> dict[str, Any]:
    validate_file(filename, len(file_bytes))
    project_data = get_project(user_id, project_id, display_name)
    if project_data is None:
        raise ValueError("Project not found.")

    project_name = str(project_data.get("name", "")).strip() or project_id
    blob_path = upload_project_file(user_id, project_id, project_name, filename, file_bytes, display_name)
    existing_chunks = load_project_parsed_chunks(user_id, project_id, filename, display_name)
    if existing_chunks is not None:
        chunk_count = len(existing_chunks)
    else:
        parsed_text = parse_file(filename, file_bytes)
        parsed_chunks = chunk_text(parsed_text)
        save_project_parsed_chunks(user_id, project_id, project_name, filename, parsed_chunks, display_name)
        chunk_count = len(parsed_chunks)

    return {
        "filename": filename,
        "blob_path": blob_path,
        "chunk_count": chunk_count,
        "message": "File uploaded successfully",
    }
