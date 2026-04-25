from __future__ import annotations

import asyncio
import json
import re
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

import httpx
from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.access import AccessContext, get_access_context, require_owner
from app.platform.audit import record_audit_event
from app.platform.chat import build_collection_context_prompt
from app.platform.crypto import dump_secret_json, redact_secret
from app.platform.db import get_platform_session
from app.platform.documents import enqueue_document_index, process_document_index, search_document_chunks, upload_platform_document_blob
from app.platform.models import (
    AgentDefinition,
    AgentRun,
    AgentRunStep,
    AgentToolBinding,
    AgentVersion,
    Document,
    DocumentCollection,
    McpEndpoint,
    ModelProvider,
    ProviderCredential,
    RoutingPolicy,
    ToolDefinition,
    WorkspaceMember,
)
from app.platform.providers import build_messages, stream_chat_with_model, test_provider_connection
from app.platform.routing import classify_route
from app.services.file_handler import validate_file

router = APIRouter(prefix="/api", tags=["platform"])


def _slugify(value: str) -> str:
    clean = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return clean or uuid.uuid4().hex[:8]


def _serialize_provider(provider: ModelProvider) -> dict[str, Any]:
    return {
        "id": provider.id,
        "provider_key": provider.provider_key,
        "display_name": provider.display_name,
        "description": provider.description,
        "enabled": provider.enabled,
        "is_default_chat": provider.is_default_chat,
        "is_default_embeddings": provider.is_default_embeddings,
        "base_url": provider.base_url,
        "api_version": provider.api_version,
        "default_chat_model": provider.default_chat_model,
        "default_embedding_model": provider.default_embedding_model,
        "allowed_models": provider.allowed_models,
        "metadata": provider.metadata_json,
        "created_at": provider.created_at.isoformat(),
        "updated_at": provider.updated_at.isoformat(),
    }


def _serialize_tool(tool: ToolDefinition) -> dict[str, Any]:
    return {
        "id": tool.id,
        "tool_slug": tool.tool_slug,
        "name": tool.name,
        "description": tool.description,
        "kind": tool.kind,
        "approval_status": tool.approval_status,
        "enabled": tool.enabled,
        "source_endpoint_id": tool.source_endpoint_id,
        "method": tool.method,
        "url": tool.url,
        "timeout_seconds": tool.timeout_seconds,
        "retry_limit": tool.retry_limit,
        "input_schema": tool.input_schema,
        "auth_config": redact_secret(tool.auth_config_encrypted),
        "response_config": tool.response_config,
        "created_at": tool.created_at.isoformat(),
        "updated_at": tool.updated_at.isoformat(),
    }


def _serialize_endpoint(endpoint: McpEndpoint) -> dict[str, Any]:
    return {
        "id": endpoint.id,
        "name": endpoint.name,
        "endpoint_url": endpoint.endpoint_url,
        "enabled": endpoint.enabled,
        "auth_config": redact_secret(endpoint.auth_config_encrypted),
        "last_synced_at": endpoint.last_synced_at.isoformat() if endpoint.last_synced_at else None,
        "last_sync_error": endpoint.last_sync_error,
        "metadata": endpoint.metadata_json,
        "created_at": endpoint.created_at.isoformat(),
        "updated_at": endpoint.updated_at.isoformat(),
    }


def _serialize_collection(collection: DocumentCollection) -> dict[str, Any]:
    return {
        "id": collection.id,
        "name": collection.name,
        "slug": collection.slug,
        "description": collection.description,
        "allowed_agent_ids": collection.allowed_agent_ids,
        "metadata": collection.metadata_json,
        "created_at": collection.created_at.isoformat(),
        "updated_at": collection.updated_at.isoformat(),
    }


def _serialize_document(document: Document) -> dict[str, Any]:
    return {
        "id": document.id,
        "collection_id": document.collection_id,
        "filename": document.filename,
        "blob_path": document.blob_path,
        "status": document.status,
        "content_type": document.content_type,
        "size_bytes": document.size_bytes,
        "chunk_count": document.chunk_count,
        "indexed_at": document.indexed_at.isoformat() if document.indexed_at else None,
        "error_message": document.error_message,
        "created_at": document.created_at.isoformat(),
        "updated_at": document.updated_at.isoformat(),
    }


def _serialize_agent(agent: AgentDefinition, version: AgentVersion | None) -> dict[str, Any]:
    return {
        "id": agent.id,
        "name": agent.name,
        "slug": agent.slug,
        "description": agent.description,
        "status": agent.status,
        "owner_user_id": agent.owner_user_id,
        "latest_version_id": agent.latest_version_id,
        "published_version_id": agent.published_version_id,
        "version": (
            {
                "id": version.id,
                "status": version.status,
                "version_number": version.version_number,
                "model_id": version.model_id,
                "system_prompt": version.system_prompt,
                "tool_ids": version.tool_ids,
                "collection_ids": version.collection_ids,
                "config": version.config_json,
                "submitted_by_user_id": version.submitted_by_user_id,
                "approved_by_user_id": version.approved_by_user_id,
                "approved_at": version.approved_at.isoformat() if version.approved_at else None,
            }
            if version
            else None
        ),
        "created_at": agent.created_at.isoformat(),
        "updated_at": agent.updated_at.isoformat(),
    }


def _coerce_scalar(value: Any, target_type: str) -> Any:
    if target_type == "string":
        return str(value)
    if target_type == "number":
        return float(value)
    if target_type == "integer":
        return int(value)
    if target_type == "boolean":
        if isinstance(value, bool):
            return value
        text = str(value).strip().lower()
        if text in {"1", "true", "yes", "on"}:
            return True
        if text in {"0", "false", "no", "off"}:
            return False
        raise ValueError(f"Unable to coerce '{value}' to boolean.")
    return value


def _coerce_args_by_schema(payload: dict[str, Any], schema: dict[str, Any]) -> dict[str, Any]:
    properties = schema.get("properties", {})
    required = set(schema.get("required", []))
    normalized: dict[str, Any] = {}
    for key, value in payload.items():
        property_schema = properties.get(key, {})
        target_type = str(property_schema.get("type", "")).strip()
        if target_type in {"string", "number", "integer", "boolean"}:
            normalized[key] = _coerce_scalar(value, target_type)
        else:
            normalized[key] = value
    missing = [key for key in required if key not in normalized]
    if missing:
        raise ValueError(f"Missing required tool arguments: {', '.join(sorted(missing))}.")
    return normalized


async def _discover_remote_mcp_tools(endpoint: McpEndpoint) -> list[dict[str, Any]]:
    headers = {"accept": "text/event-stream, application/json"}
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(endpoint.endpoint_url, headers=headers)
        response.raise_for_status()
        content_type = response.headers.get("content-type", "")
        tools: list[dict[str, Any]] = []
        if "application/json" in content_type:
            payload = response.json()
            raw_tools = payload.get("tools", []) if isinstance(payload, dict) else []
            for raw_tool in raw_tools:
                if not isinstance(raw_tool, dict):
                    continue
                tools.append(raw_tool)
            return tools

        for line in response.text.splitlines():
            if not line.startswith("data:"):
                continue
            raw_data = line.removeprefix("data:").strip()
            if not raw_data:
                continue
            try:
                payload = json.loads(raw_data)
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict) and isinstance(payload.get("tools"), list):
                for raw_tool in payload["tools"]:
                    if isinstance(raw_tool, dict):
                        tools.append(raw_tool)
                break
        return tools


async def _run_http_tool(tool: ToolDefinition, args: dict[str, Any]) -> dict[str, Any]:
    if not tool.url or not tool.method:
        raise ValueError("HTTP tool is missing url or method.")
    normalized_args = _coerce_args_by_schema(args, tool.input_schema or {})
    method = tool.method.upper()
    async with httpx.AsyncClient(timeout=float(tool.timeout_seconds or 20)) as client:
        if method == "GET":
            response = await client.get(tool.url, params=normalized_args)
        else:
            response = await client.request(method, tool.url, json=normalized_args)
        response.raise_for_status()
        try:
            payload = response.json()
        except Exception:
            payload = {"text": response.text}
    return {"status_code": response.status_code, "payload": payload}


class ProviderCreateRequest(BaseModel):
    provider_key: str = Field(..., min_length=2)
    display_name: str = Field(..., min_length=2)
    description: str | None = None
    enabled: bool = True
    is_default_chat: bool = False
    is_default_embeddings: bool = False
    base_url: str | None = None
    api_version: str | None = None
    default_chat_model: str | None = None
    default_embedding_model: str | None = None
    allowed_models: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    credentials: dict[str, Any] = Field(default_factory=dict)


class ProviderUpdateRequest(BaseModel):
    display_name: str | None = None
    description: str | None = None
    enabled: bool | None = None
    is_default_chat: bool | None = None
    is_default_embeddings: bool | None = None
    base_url: str | None = None
    api_version: str | None = None
    default_chat_model: str | None = None
    default_embedding_model: str | None = None
    allowed_models: list[str] | None = None
    metadata: dict[str, Any] | None = None
    credentials: dict[str, Any] | None = None


class ToolRequest(BaseModel):
    name: str = Field(..., min_length=2)
    description: str | None = None
    tool_slug: str | None = None
    kind: str = Field(default="http")
    method: str | None = None
    url: str | None = None
    timeout_seconds: int = Field(default=20, ge=1, le=120)
    retry_limit: int = Field(default=1, ge=0, le=5)
    input_schema: dict[str, Any] = Field(default_factory=dict)
    auth_config: dict[str, Any] = Field(default_factory=dict)
    response_config: dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True


class McpEndpointRequest(BaseModel):
    name: str = Field(..., min_length=2)
    endpoint_url: str = Field(..., min_length=8)
    enabled: bool = True
    auth_config: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AgentVersionRequest(BaseModel):
    name: str = Field(..., min_length=2)
    description: str | None = None
    model_id: str | None = None
    system_prompt: str = Field(default="")
    tool_ids: list[str] = Field(default_factory=list)
    collection_ids: list[str] = Field(default_factory=list)
    config: dict[str, Any] = Field(default_factory=dict)


class CollectionRequest(BaseModel):
    name: str = Field(..., min_length=2)
    description: str | None = None
    allowed_agent_ids: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class RouterPreviewRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=12000)
    collection_id: str | None = None
    dynamic_agent_id: str | None = None


class ToolExecuteRequest(BaseModel):
    args: dict[str, Any] = Field(default_factory=dict)


class AgentTestRunRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=12000)
    model_id: str | None = None


@router.get("/providers")
def get_providers(
    _ctx: AccessContext = Depends(get_access_context),
    session: Session = Depends(get_platform_session),
) -> dict[str, Any]:
    providers = session.execute(select(ModelProvider).order_by(ModelProvider.display_name.asc())).scalars().all()
    return {"providers": [_serialize_provider(provider) for provider in providers]}


@router.post("/providers")
def post_provider(
    body: ProviderCreateRequest,
    ctx: AccessContext = Depends(require_owner),
    session: Session = Depends(get_platform_session),
) -> dict[str, Any]:
    provider = ModelProvider(
        provider_key=body.provider_key.strip().lower(),
        display_name=body.display_name.strip(),
        description=body.description.strip() if isinstance(body.description, str) and body.description.strip() else None,
        enabled=body.enabled,
        is_default_chat=body.is_default_chat,
        is_default_embeddings=body.is_default_embeddings,
        base_url=body.base_url.strip() if isinstance(body.base_url, str) and body.base_url.strip() else None,
        api_version=body.api_version.strip() if isinstance(body.api_version, str) and body.api_version.strip() else None,
        default_chat_model=body.default_chat_model.strip() if isinstance(body.default_chat_model, str) and body.default_chat_model.strip() else None,
        default_embedding_model=body.default_embedding_model.strip() if isinstance(body.default_embedding_model, str) and body.default_embedding_model.strip() else None,
        allowed_models=[item.strip() for item in body.allowed_models if item.strip()],
        metadata_json=body.metadata,
    )
    session.add(provider)
    session.flush()
    if body.credentials:
        session.add(ProviderCredential(provider_id=provider.id, secret_payload=dump_secret_json(body.credentials)))
    record_audit_event(session, actor_user_id=ctx.user_id, event_type="provider.created", target_type="provider", target_id=provider.id)
    session.commit()
    session.refresh(provider)
    return {"provider": _serialize_provider(provider)}


@router.patch("/providers/{provider_id}")
def patch_provider(
    provider_id: str,
    body: ProviderUpdateRequest,
    ctx: AccessContext = Depends(require_owner),
    session: Session = Depends(get_platform_session),
) -> dict[str, Any]:
    provider = session.get(ModelProvider, provider_id)
    if provider is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Provider not found.")
    for field_name in (
        "display_name",
        "description",
        "enabled",
        "is_default_chat",
        "is_default_embeddings",
        "base_url",
        "api_version",
        "default_chat_model",
        "default_embedding_model",
        "allowed_models",
        "metadata",
    ):
        value = getattr(body, field_name)
        if value is None:
            continue
        target_name = "metadata_json" if field_name == "metadata" else field_name
        setattr(provider, target_name, value)
    if body.credentials is not None:
        credential = session.execute(
            select(ProviderCredential).where(ProviderCredential.provider_id == provider.id).order_by(ProviderCredential.created_at.desc())
        ).scalar_one_or_none()
        if credential is None:
            credential = ProviderCredential(provider_id=provider.id)
            session.add(credential)
        credential.secret_payload = dump_secret_json(body.credentials)
    record_audit_event(session, actor_user_id=ctx.user_id, event_type="provider.updated", target_type="provider", target_id=provider.id)
    session.commit()
    return {"provider": _serialize_provider(provider)}


@router.post("/providers/{provider_id}/test")
async def post_provider_test(
    provider_id: str,
    _ctx: AccessContext = Depends(require_owner),
    session: Session = Depends(get_platform_session),
) -> dict[str, Any]:
    return {"result": await test_provider_connection(session, provider_id)}


@router.get("/tools")
def get_tools(
    _ctx: AccessContext = Depends(get_access_context),
    session: Session = Depends(get_platform_session),
) -> dict[str, Any]:
    tools = session.execute(select(ToolDefinition).order_by(ToolDefinition.name.asc())).scalars().all()
    return {"tools": [_serialize_tool(tool) for tool in tools]}


@router.post("/tools")
def post_tool(
    body: ToolRequest,
    ctx: AccessContext = Depends(get_access_context),
    session: Session = Depends(get_platform_session),
) -> dict[str, Any]:
    tool = ToolDefinition(
        tool_slug=_slugify(body.tool_slug or body.name),
        name=body.name.strip(),
        description=body.description,
        kind=body.kind.strip().lower(),
        method=body.method.strip().upper() if isinstance(body.method, str) and body.method.strip() else None,
        url=body.url.strip() if isinstance(body.url, str) and body.url.strip() else None,
        timeout_seconds=body.timeout_seconds,
        retry_limit=body.retry_limit,
        input_schema=body.input_schema,
        auth_config_encrypted=dump_secret_json(body.auth_config),
        response_config=body.response_config,
        enabled=body.enabled,
        approval_status="approved" if ctx.is_owner() else "draft",
    )
    session.add(tool)
    record_audit_event(session, actor_user_id=ctx.user_id, event_type="tool.created", target_type="tool", target_id=tool.id)
    session.commit()
    return {"tool": _serialize_tool(tool)}


@router.patch("/tools/{tool_id}")
def patch_tool(
    tool_id: str,
    body: ToolRequest,
    ctx: AccessContext = Depends(get_access_context),
    session: Session = Depends(get_platform_session),
) -> dict[str, Any]:
    tool = session.get(ToolDefinition, tool_id)
    if tool is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tool not found.")
    tool.name = body.name.strip()
    tool.description = body.description
    tool.kind = body.kind.strip().lower()
    tool.method = body.method.strip().upper() if isinstance(body.method, str) and body.method.strip() else None
    tool.url = body.url.strip() if isinstance(body.url, str) and body.url.strip() else None
    tool.timeout_seconds = body.timeout_seconds
    tool.retry_limit = body.retry_limit
    tool.input_schema = body.input_schema
    if body.auth_config:
        tool.auth_config_encrypted = dump_secret_json(body.auth_config)
    tool.response_config = body.response_config
    tool.enabled = body.enabled
    if not ctx.is_owner():
        tool.approval_status = "draft"
    record_audit_event(session, actor_user_id=ctx.user_id, event_type="tool.updated", target_type="tool", target_id=tool.id)
    session.commit()
    return {"tool": _serialize_tool(tool)}


@router.post("/tools/{tool_id}/approve")
def approve_tool(
    tool_id: str,
    ctx: AccessContext = Depends(require_owner),
    session: Session = Depends(get_platform_session),
) -> dict[str, Any]:
    tool = session.get(ToolDefinition, tool_id)
    if tool is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tool not found.")
    tool.approval_status = "approved"
    record_audit_event(session, actor_user_id=ctx.user_id, event_type="tool.approved", target_type="tool", target_id=tool.id)
    session.commit()
    return {"tool": _serialize_tool(tool)}


@router.post("/tools/{tool_id}/execute")
async def post_tool_execute(
    tool_id: str,
    body: ToolExecuteRequest,
    _ctx: AccessContext = Depends(get_access_context),
    session: Session = Depends(get_platform_session),
) -> dict[str, Any]:
    tool = session.get(ToolDefinition, tool_id)
    if tool is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tool not found.")
    if tool.kind != "http":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only HTTP tools can be executed directly.")
    if tool.approval_status != "approved" or not tool.enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This tool is not approved for execution.")
    return {"result": await _run_http_tool(tool, body.args)}


@router.get("/mcp/endpoints")
def get_mcp_endpoints(
    _ctx: AccessContext = Depends(get_access_context),
    session: Session = Depends(get_platform_session),
) -> dict[str, Any]:
    endpoints = session.execute(select(McpEndpoint).order_by(McpEndpoint.name.asc())).scalars().all()
    return {"endpoints": [_serialize_endpoint(endpoint) for endpoint in endpoints]}


@router.post("/mcp/endpoints")
def post_mcp_endpoint(
    body: McpEndpointRequest,
    ctx: AccessContext = Depends(get_access_context),
    session: Session = Depends(get_platform_session),
) -> dict[str, Any]:
    endpoint = McpEndpoint(
        name=body.name.strip(),
        endpoint_url=body.endpoint_url.strip(),
        enabled=body.enabled,
        auth_config_encrypted=dump_secret_json(body.auth_config),
        metadata_json=body.metadata,
    )
    session.add(endpoint)
    record_audit_event(session, actor_user_id=ctx.user_id, event_type="mcp.created", target_type="mcp_endpoint", target_id=endpoint.id)
    session.commit()
    return {"endpoint": _serialize_endpoint(endpoint)}


@router.patch("/mcp/endpoints/{endpoint_id}")
def patch_mcp_endpoint(
    endpoint_id: str,
    body: McpEndpointRequest,
    ctx: AccessContext = Depends(get_access_context),
    session: Session = Depends(get_platform_session),
) -> dict[str, Any]:
    endpoint = session.get(McpEndpoint, endpoint_id)
    if endpoint is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MCP endpoint not found.")
    endpoint.name = body.name.strip()
    endpoint.endpoint_url = body.endpoint_url.strip()
    endpoint.enabled = body.enabled
    endpoint.auth_config_encrypted = dump_secret_json(body.auth_config)
    endpoint.metadata_json = body.metadata
    record_audit_event(session, actor_user_id=ctx.user_id, event_type="mcp.updated", target_type="mcp_endpoint", target_id=endpoint.id)
    session.commit()
    return {"endpoint": _serialize_endpoint(endpoint)}


@router.post("/mcp/endpoints/{endpoint_id}/sync")
async def post_mcp_sync(
    endpoint_id: str,
    ctx: AccessContext = Depends(get_access_context),
    session: Session = Depends(get_platform_session),
) -> dict[str, Any]:
    endpoint = session.get(McpEndpoint, endpoint_id)
    if endpoint is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MCP endpoint not found.")
    try:
        discovered_tools = await _discover_remote_mcp_tools(endpoint)
        synced: list[dict[str, Any]] = []
        for raw_tool in discovered_tools:
            slug = _slugify(str(raw_tool.get("slug") or raw_tool.get("name") or "mcp-tool"))
            tool = session.execute(select(ToolDefinition).where(ToolDefinition.tool_slug == slug)).scalar_one_or_none()
            if tool is None:
                tool = ToolDefinition(tool_slug=slug, name=str(raw_tool.get("name") or slug), kind="mcp", source_endpoint_id=endpoint.id)
                session.add(tool)
            tool.description = str(raw_tool.get("description") or "")
            tool.input_schema = raw_tool.get("input_schema") if isinstance(raw_tool.get("input_schema"), dict) else {}
            tool.response_config = raw_tool.get("response_config") if isinstance(raw_tool.get("response_config"), dict) else {}
            tool.approval_status = "approved" if ctx.is_owner() else tool.approval_status
            synced.append(_serialize_tool(tool))
        endpoint.last_synced_at = datetime.now(UTC)
        endpoint.last_sync_error = None
        record_audit_event(session, actor_user_id=ctx.user_id, event_type="mcp.synced", target_type="mcp_endpoint", target_id=endpoint.id, payload={"tools": len(synced)})
        session.commit()
        return {"endpoint": _serialize_endpoint(endpoint), "tools": synced}
    except Exception as error:
        endpoint.last_sync_error = str(error)
        session.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unable to sync MCP endpoint: {error}") from error


@router.get("/collections")
def get_collections(
    _ctx: AccessContext = Depends(get_access_context),
    session: Session = Depends(get_platform_session),
) -> dict[str, Any]:
    collections = session.execute(select(DocumentCollection).order_by(DocumentCollection.name.asc())).scalars().all()
    return {"collections": [_serialize_collection(item) for item in collections]}


@router.post("/collections")
def post_collection(
    body: CollectionRequest,
    ctx: AccessContext = Depends(get_access_context),
    session: Session = Depends(get_platform_session),
) -> dict[str, Any]:
    collection = DocumentCollection(
        name=body.name.strip(),
        slug=_slugify(body.name),
        description=body.description,
        allowed_agent_ids=body.allowed_agent_ids,
        metadata_json=body.metadata,
    )
    session.add(collection)
    record_audit_event(session, actor_user_id=ctx.user_id, event_type="collection.created", target_type="collection", target_id=collection.id)
    session.commit()
    return {"collection": _serialize_collection(collection)}


@router.patch("/collections/{collection_id}")
def patch_collection(
    collection_id: str,
    body: CollectionRequest,
    ctx: AccessContext = Depends(get_access_context),
    session: Session = Depends(get_platform_session),
) -> dict[str, Any]:
    collection = session.get(DocumentCollection, collection_id)
    if collection is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found.")
    collection.name = body.name.strip()
    collection.slug = _slugify(body.name)
    collection.description = body.description
    collection.allowed_agent_ids = body.allowed_agent_ids
    collection.metadata_json = body.metadata
    record_audit_event(session, actor_user_id=ctx.user_id, event_type="collection.updated", target_type="collection", target_id=collection.id)
    session.commit()
    return {"collection": _serialize_collection(collection)}


@router.get("/documents")
def get_documents(
    collection_id: str | None = None,
    _ctx: AccessContext = Depends(get_access_context),
    session: Session = Depends(get_platform_session),
) -> dict[str, Any]:
    statement = select(Document).order_by(Document.created_at.desc())
    if collection_id:
        statement = statement.where(Document.collection_id == collection_id)
    documents = session.execute(statement).scalars().all()
    return {"documents": [_serialize_document(item) for item in documents]}


@router.post("/documents")
async def post_document(
    collection_id: str = Form(...),
    file: UploadFile = File(...),
    ctx: AccessContext = Depends(get_access_context),
    session: Session = Depends(get_platform_session),
) -> dict[str, Any]:
    collection = session.get(DocumentCollection, collection_id)
    if collection is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found.")
    file_bytes = await file.read()
    validate_file(file.filename or "", len(file_bytes))
    document = Document(
        collection_id=collection_id,
        filename=file.filename or "document.txt",
        blob_path="",
        status="uploaded",
        content_type=file.content_type,
        size_bytes=len(file_bytes),
    )
    session.add(document)
    session.flush()
    document.blob_path = upload_platform_document_blob(collection_id, document.id, document.filename, file_bytes)
    document.status = "queued"
    session.commit()
    enqueue_document_index(document.id)
    record_audit_event(session, actor_user_id=ctx.user_id, event_type="document.uploaded", target_type="document", target_id=document.id)
    return {"document": _serialize_document(document)}


@router.post("/documents/{document_id}/reindex")
async def post_document_reindex(
    document_id: str,
    ctx: AccessContext = Depends(get_access_context),
    session: Session = Depends(get_platform_session),
) -> dict[str, Any]:
    document = session.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")
    document.status = "queued"
    document.error_message = None
    session.commit()
    enqueue_document_index(document.id)
    record_audit_event(session, actor_user_id=ctx.user_id, event_type="document.reindexed", target_type="document", target_id=document.id)
    return {"document": _serialize_document(document)}


@router.post("/documents/{document_id}/process-now")
async def post_document_process_now(
    document_id: str,
    _ctx: AccessContext = Depends(require_owner),
    session: Session = Depends(get_platform_session),
) -> dict[str, Any]:
    return {"result": await process_document_index(document_id, session)}


@router.get("/agents")
def get_agents(
    _ctx: AccessContext = Depends(get_access_context),
    session: Session = Depends(get_platform_session),
) -> dict[str, Any]:
    agents = session.execute(select(AgentDefinition).order_by(AgentDefinition.name.asc())).scalars().all()
    payload: list[dict[str, Any]] = []
    for agent in agents:
        version = session.get(AgentVersion, agent.latest_version_id) if agent.latest_version_id else None
        payload.append(_serialize_agent(agent, version))
    return {"agents": payload}


@router.post("/agents")
def post_agent(
    body: AgentVersionRequest,
    ctx: AccessContext = Depends(get_access_context),
    session: Session = Depends(get_platform_session),
) -> dict[str, Any]:
    agent = AgentDefinition(
        name=body.name.strip(),
        slug=_slugify(body.name),
        description=body.description,
        status="draft",
        owner_user_id=ctx.user_id,
    )
    session.add(agent)
    session.flush()
    version = AgentVersion(
        agent_id=agent.id,
        version_number=1,
        status="draft",
        model_id=body.model_id,
        system_prompt=body.system_prompt,
        tool_ids=body.tool_ids,
        collection_ids=body.collection_ids,
        config_json=body.config,
    )
    session.add(version)
    session.flush()
    agent.latest_version_id = version.id
    for tool_id in body.tool_ids:
        existing = session.execute(
            select(AgentToolBinding).where(AgentToolBinding.agent_id == agent.id, AgentToolBinding.tool_id == tool_id)
        ).scalar_one_or_none()
        if existing is None:
            session.add(AgentToolBinding(agent_id=agent.id, tool_id=tool_id, approved=ctx.is_owner(), approved_by_user_id=ctx.user_id if ctx.is_owner() else None))
    record_audit_event(session, actor_user_id=ctx.user_id, event_type="agent.created", target_type="agent", target_id=agent.id)
    session.commit()
    return {"agent": _serialize_agent(agent, version)}


@router.patch("/agents/{agent_id}")
def patch_agent(
    agent_id: str,
    body: AgentVersionRequest,
    ctx: AccessContext = Depends(get_access_context),
    session: Session = Depends(get_platform_session),
) -> dict[str, Any]:
    agent = session.get(AgentDefinition, agent_id)
    if agent is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found.")
    current_version = session.get(AgentVersion, agent.latest_version_id) if agent.latest_version_id else None
    next_version_number = (current_version.version_number + 1) if current_version else 1
    agent.name = body.name.strip()
    agent.slug = _slugify(body.name)
    agent.description = body.description
    agent.status = "draft"
    version = AgentVersion(
        agent_id=agent.id,
        version_number=next_version_number,
        status="draft",
        model_id=body.model_id,
        system_prompt=body.system_prompt,
        tool_ids=body.tool_ids,
        collection_ids=body.collection_ids,
        config_json=body.config,
    )
    session.add(version)
    session.flush()
    agent.latest_version_id = version.id
    for tool_id in body.tool_ids:
        binding = session.execute(
            select(AgentToolBinding).where(AgentToolBinding.agent_id == agent.id, AgentToolBinding.tool_id == tool_id)
        ).scalar_one_or_none()
        if binding is None:
            session.add(AgentToolBinding(agent_id=agent.id, tool_id=tool_id, approved=ctx.is_owner(), approved_by_user_id=ctx.user_id if ctx.is_owner() else None))
    record_audit_event(session, actor_user_id=ctx.user_id, event_type="agent.updated", target_type="agent", target_id=agent.id)
    session.commit()
    return {"agent": _serialize_agent(agent, version)}


@router.post("/agents/{agent_id}/submit")
def submit_agent(
    agent_id: str,
    ctx: AccessContext = Depends(get_access_context),
    session: Session = Depends(get_platform_session),
) -> dict[str, Any]:
    agent = session.get(AgentDefinition, agent_id)
    if agent is None or not agent.latest_version_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found.")
    version = session.get(AgentVersion, agent.latest_version_id)
    if version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent version not found.")
    agent.status = "pending_approval"
    version.status = "pending_approval"
    version.submitted_by_user_id = ctx.user_id
    record_audit_event(session, actor_user_id=ctx.user_id, event_type="agent.submitted", target_type="agent", target_id=agent.id)
    session.commit()
    return {"agent": _serialize_agent(agent, version)}


@router.post("/agents/{agent_id}/approve")
def approve_agent(
    agent_id: str,
    ctx: AccessContext = Depends(require_owner),
    session: Session = Depends(get_platform_session),
) -> dict[str, Any]:
    agent = session.get(AgentDefinition, agent_id)
    if agent is None or not agent.latest_version_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found.")
    version = session.get(AgentVersion, agent.latest_version_id)
    if version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent version not found.")
    agent.status = "published"
    agent.published_version_id = version.id
    version.status = "published"
    version.approved_by_user_id = ctx.user_id
    version.approved_at = datetime.now(UTC)
    bindings = session.execute(select(AgentToolBinding).where(AgentToolBinding.agent_id == agent.id)).scalars().all()
    for binding in bindings:
        binding.approved = True
        binding.approved_by_user_id = ctx.user_id
    record_audit_event(session, actor_user_id=ctx.user_id, event_type="agent.approved", target_type="agent", target_id=agent.id)
    session.commit()
    return {"agent": _serialize_agent(agent, version)}


@router.post("/agents/{agent_id}/archive")
def archive_agent(
    agent_id: str,
    ctx: AccessContext = Depends(require_owner),
    session: Session = Depends(get_platform_session),
) -> dict[str, Any]:
    agent = session.get(AgentDefinition, agent_id)
    if agent is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found.")
    agent.status = "archived"
    record_audit_event(session, actor_user_id=ctx.user_id, event_type="agent.archived", target_type="agent", target_id=agent.id)
    session.commit()
    version = session.get(AgentVersion, agent.latest_version_id) if agent.latest_version_id else None
    return {"agent": _serialize_agent(agent, version)}


@router.post("/agents/{agent_id}/bindings/{tool_id}/approve")
def approve_agent_tool_binding(
    agent_id: str,
    tool_id: str,
    ctx: AccessContext = Depends(require_owner),
    session: Session = Depends(get_platform_session),
) -> dict[str, Any]:
    binding = session.execute(
        select(AgentToolBinding).where(AgentToolBinding.agent_id == agent_id, AgentToolBinding.tool_id == tool_id)
    ).scalar_one_or_none()
    if binding is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent tool binding not found.")
    binding.approved = True
    binding.approved_by_user_id = ctx.user_id
    record_audit_event(session, actor_user_id=ctx.user_id, event_type="binding.approved", target_type="agent_tool_binding", target_id=binding.id)
    session.commit()
    return {"binding": {"id": binding.id, "agent_id": binding.agent_id, "tool_id": binding.tool_id, "approved": binding.approved}}


@router.post("/agents/{agent_id}/test-run")
async def post_agent_test_run(
    agent_id: str,
    body: AgentTestRunRequest,
    ctx: AccessContext = Depends(get_access_context),
    session: Session = Depends(get_platform_session),
):
    agent = session.get(AgentDefinition, agent_id)
    if agent is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found.")
    version_id = agent.latest_version_id or agent.published_version_id
    version = session.get(AgentVersion, version_id) if version_id else None
    if version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent version not found.")
    collection_prompt, citations = await build_collection_context_prompt(session, version.collection_ids, body.message)
    messages = build_messages(
        history=[],
        newest_message=body.message,
        memory_prompt=version.system_prompt,
        file_prompt=collection_prompt,
    )
    run = AgentRun(
        kind="agent_test",
        user_id=ctx.user_id,
        agent_id=agent.id,
        route_kind="dynamic_agent",
        route_confidence=1.0,
        resolved_model=body.model_id or version.model_id,
        input_text=body.message,
    )
    session.add(run)
    session.commit()

    async def stream() -> AsyncIterator[str]:
        yield json.dumps(
            {
                "type": "route",
                "route_kind": "dynamic_agent",
                "resolved_agent_id": agent.id,
                "resolved_model": body.model_id or version.model_id,
                "route_confidence": 1.0,
            },
            ensure_ascii=True,
        ) + "\n"
        output_parts: list[str] = []
        async for event, runtime in stream_chat_with_model(session, body.model_id or version.model_id, messages):
            if event.get("type") == "token":
                output_parts.append(str(event.get("content", "")))
                yield json.dumps(event, ensure_ascii=True) + "\n"
            if event.get("type") == "usage":
                session.add(
                    AgentRunStep(
                        run_id=run.id,
                        step_type="completion",
                        title="Agent test run completion",
                        payload_json={"usage": event.get("usage", {})},
                    )
                )
                run.output_text = "".join(output_parts)
                run.status = "completed"
                run.resolved_model = f"{runtime.provider_key}:{runtime.model_name}" if runtime.model_name else runtime.provider_key
                session.commit()
                if citations:
                    yield json.dumps({"type": "sources", "sources": citations}, ensure_ascii=True) + "\n"
                yield json.dumps(
                    {
                        "type": "done",
                        "content": "",
                        "resolved_provider": runtime.provider_key,
                        "resolved_model": run.resolved_model,
                        "resolved_agent_id": agent.id,
                        "route_kind": "dynamic_agent",
                        "route_confidence": 1.0,
                        "sources": citations,
                    },
                    ensure_ascii=True,
                ) + "\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson")


@router.get("/router")
def get_router_config(
    _ctx: AccessContext = Depends(get_access_context),
    session: Session = Depends(get_platform_session),
) -> dict[str, Any]:
    policy = session.execute(select(RoutingPolicy).order_by(RoutingPolicy.created_at.desc())).scalar_one_or_none()
    if policy is None:
        return {"policy": {"name": "default", "confidence_threshold": 0.65, "enabled": True, "config": {}}}
    return {
        "policy": {
            "id": policy.id,
            "name": policy.name,
            "confidence_threshold": policy.confidence_threshold,
            "enabled": policy.enabled,
            "config": policy.config_json,
        }
    }


@router.post("/router/preview")
async def post_router_preview(
    body: RouterPreviewRequest,
    _ctx: AccessContext = Depends(get_access_context),
    session: Session = Depends(get_platform_session),
) -> dict[str, Any]:
    decision = await classify_route(body.model_dump(), session)
    return {"route": decision.to_payload()}


@router.get("/platform/workspace-members")
def get_workspace_members(
    _ctx: AccessContext = Depends(require_owner),
    session: Session = Depends(get_platform_session),
) -> dict[str, Any]:
    members = session.execute(select(WorkspaceMember).order_by(WorkspaceMember.display_name.asc())).scalars().all()
    return {
        "members": [
            {
                "id": member.id,
                "user_id": member.user_id,
                "email": member.email,
                "display_name": member.display_name,
                "role": member.role,
                "feature_overrides": member.feature_overrides,
                "usage_limits": member.usage_limits,
                "seeded_owner": member.seeded_owner,
            }
            for member in members
        ]
    }
