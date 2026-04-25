from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .config import get_platform_settings
from .db import Base


def _utcnow() -> datetime:
    return datetime.now(UTC)


class PlatformMixin:
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: uuid.uuid4().hex)
    workspace_key: Mapped[str] = mapped_column(String(64), default=lambda: get_platform_settings().workspace_key, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)


class WorkspaceMember(PlatformMixin, Base):
    __tablename__ = "workspace_members"

    user_id: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[str] = mapped_column(String(32), default="user")
    feature_overrides: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    usage_limits: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    seeded_owner: Mapped[bool] = mapped_column(Boolean, default=False)


class ModelProvider(PlatformMixin, Base):
    __tablename__ = "model_providers"

    provider_key: Mapped[str] = mapped_column(String(64), index=True)
    display_name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    is_default_chat: Mapped[bool] = mapped_column(Boolean, default=False)
    is_default_embeddings: Mapped[bool] = mapped_column(Boolean, default=False)
    base_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    api_version: Mapped[str | None] = mapped_column(String(128), nullable=True)
    default_chat_model: Mapped[str | None] = mapped_column(String(255), nullable=True)
    default_embedding_model: Mapped[str | None] = mapped_column(String(255), nullable=True)
    allowed_models: Mapped[list[str]] = mapped_column(JSON, default=list)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class ProviderCredential(PlatformMixin, Base):
    __tablename__ = "provider_credentials"

    provider_id: Mapped[str] = mapped_column(ForeignKey("model_providers.id", ondelete="CASCADE"), index=True)
    secret_payload: Mapped[str] = mapped_column(Text, default="")


class MpcEndpointPlaceholder:
    pass


class ToolDefinition(PlatformMixin, Base):
    __tablename__ = "tool_definitions"

    tool_slug: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    kind: Mapped[str] = mapped_column(String(32), default="http")
    approval_status: Mapped[str] = mapped_column(String(32), default="draft")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    source_endpoint_id: Mapped[str | None] = mapped_column(ForeignKey("mcp_endpoints.id", ondelete="SET NULL"), nullable=True)
    method: Mapped[str | None] = mapped_column(String(16), nullable=True)
    url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    timeout_seconds: Mapped[int] = mapped_column(Integer, default=20)
    retry_limit: Mapped[int] = mapped_column(Integer, default=1)
    input_schema: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    auth_config_encrypted: Mapped[str] = mapped_column(Text, default="")
    response_config: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class MpcEndpointMixin(PlatformMixin):
    pass


class McpEndpoint(PlatformMixin, Base):
    __tablename__ = "mcp_endpoints"

    name: Mapped[str] = mapped_column(String(255))
    endpoint_url: Mapped[str] = mapped_column(String(1024))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    auth_config_encrypted: Mapped[str] = mapped_column(Text, default="")
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_sync_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class AgentDefinition(PlatformMixin, Base):
    __tablename__ = "agent_definitions"

    name: Mapped[str] = mapped_column(String(255))
    slug: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="draft")
    latest_version_id: Mapped[str | None] = mapped_column(ForeignKey("agent_versions.id", ondelete="SET NULL"), nullable=True)
    published_version_id: Mapped[str | None] = mapped_column(ForeignKey("agent_versions.id", ondelete="SET NULL"), nullable=True)
    owner_user_id: Mapped[str] = mapped_column(String(128), index=True)


class AgentVersion(PlatformMixin, Base):
    __tablename__ = "agent_versions"

    agent_id: Mapped[str] = mapped_column(ForeignKey("agent_definitions.id", ondelete="CASCADE"), index=True)
    version_number: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(32), default="draft")
    model_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    system_prompt: Mapped[str] = mapped_column(Text, default="")
    tool_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    collection_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    config_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    submitted_by_user_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    approved_by_user_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AgentToolBinding(PlatformMixin, Base):
    __tablename__ = "agent_tool_bindings"

    agent_id: Mapped[str] = mapped_column(ForeignKey("agent_definitions.id", ondelete="CASCADE"), index=True)
    tool_id: Mapped[str] = mapped_column(ForeignKey("tool_definitions.id", ondelete="CASCADE"), index=True)
    approved: Mapped[bool] = mapped_column(Boolean, default=False)
    approved_by_user_id: Mapped[str | None] = mapped_column(String(128), nullable=True)


class DocumentCollection(PlatformMixin, Base):
    __tablename__ = "document_collections"

    name: Mapped[str] = mapped_column(String(255))
    slug: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    allowed_agent_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class Document(PlatformMixin, Base):
    __tablename__ = "documents"

    collection_id: Mapped[str] = mapped_column(ForeignKey("document_collections.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    blob_path: Mapped[str] = mapped_column(String(1024))
    status: Mapped[str] = mapped_column(String(32), default="uploaded")
    content_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    indexed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)


class DocumentChunk(PlatformMixin, Base):
    __tablename__ = "document_chunks"

    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    collection_id: Mapped[str] = mapped_column(ForeignKey("document_collections.id", ondelete="CASCADE"), index=True)
    chunk_index: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    token_count: Mapped[int] = mapped_column(Integer, default=0)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(get_platform_settings().default_embedding_dimensions), nullable=True)


class RoutingPolicy(PlatformMixin, Base):
    __tablename__ = "routing_policies"

    name: Mapped[str] = mapped_column(String(128), unique=True, default="default")
    confidence_threshold: Mapped[float] = mapped_column(Float, default=lambda: get_platform_settings().route_confidence_threshold)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    config_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class AgentRun(PlatformMixin, Base):
    __tablename__ = "agent_runs"

    kind: Mapped[str] = mapped_column(String(32), default="router_chat")
    user_id: Mapped[str] = mapped_column(String(128), index=True)
    session_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    agent_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    collection_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    route_kind: Mapped[str] = mapped_column(String(32), default="general")
    route_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    resolved_model: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="running")
    input_text: Mapped[str] = mapped_column(Text, default="")
    output_text: Mapped[str] = mapped_column(Text, default="")
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class AgentRunStep(PlatformMixin, Base):
    __tablename__ = "agent_run_steps"

    run_id: Mapped[str] = mapped_column(ForeignKey("agent_runs.id", ondelete="CASCADE"), index=True)
    step_type: Mapped[str] = mapped_column(String(64), default="message")
    status: Mapped[str] = mapped_column(String(32), default="done")
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class AuditEvent(PlatformMixin, Base):
    __tablename__ = "audit_events"

    actor_user_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    event_type: Mapped[str] = mapped_column(String(128), index=True)
    target_type: Mapped[str] = mapped_column(String(128))
    target_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


Index("ix_agent_versions_agent_status", AgentVersion.agent_id, AgentVersion.status)
Index("ix_documents_collection_status", Document.collection_id, Document.status)
Index("ix_chunks_collection_document", DocumentChunk.collection_id, DocumentChunk.document_id)
