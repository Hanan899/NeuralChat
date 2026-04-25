"""platform mvp

Revision ID: 0001_platform_mvp
Revises:
Create Date: 2026-04-24 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import pgvector.sqlalchemy
import sqlalchemy as sa


revision = "0001_platform_mvp"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "workspace_members",
        sa.Column("user_id", sa.String(length=128), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("feature_overrides", sa.JSON(), nullable=False),
        sa.Column("usage_limits", sa.JSON(), nullable=False),
        sa.Column("seeded_owner", sa.Boolean(), nullable=False),
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("workspace_key", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index(op.f("ix_workspace_members_workspace_key"), "workspace_members", ["workspace_key"], unique=False)

    op.create_table(
        "model_providers",
        sa.Column("provider_key", sa.String(length=64), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("is_default_chat", sa.Boolean(), nullable=False),
        sa.Column("is_default_embeddings", sa.Boolean(), nullable=False),
        sa.Column("base_url", sa.String(length=512), nullable=True),
        sa.Column("api_version", sa.String(length=128), nullable=True),
        sa.Column("default_chat_model", sa.String(length=255), nullable=True),
        sa.Column("default_embedding_model", sa.String(length=255), nullable=True),
        sa.Column("allowed_models", sa.JSON(), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("workspace_key", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_model_providers_provider_key"), "model_providers", ["provider_key"], unique=False)
    op.create_index(op.f("ix_model_providers_workspace_key"), "model_providers", ["workspace_key"], unique=False)

    op.create_table(
        "provider_credentials",
        sa.Column("provider_id", sa.String(length=64), nullable=False),
        sa.Column("secret_payload", sa.Text(), nullable=False),
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("workspace_key", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["provider_id"], ["model_providers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_provider_credentials_provider_id"), "provider_credentials", ["provider_id"], unique=False)
    op.create_index(op.f("ix_provider_credentials_workspace_key"), "provider_credentials", ["workspace_key"], unique=False)

    op.create_table(
        "mcp_endpoints",
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("endpoint_url", sa.String(length=1024), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("auth_config_encrypted", sa.Text(), nullable=False),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_sync_error", sa.Text(), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("workspace_key", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_mcp_endpoints_workspace_key"), "mcp_endpoints", ["workspace_key"], unique=False)

    op.create_table(
        "tool_definitions",
        sa.Column("tool_slug", sa.String(length=128), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("approval_status", sa.String(length=32), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("source_endpoint_id", sa.String(length=64), nullable=True),
        sa.Column("method", sa.String(length=16), nullable=True),
        sa.Column("url", sa.String(length=1024), nullable=True),
        sa.Column("timeout_seconds", sa.Integer(), nullable=False),
        sa.Column("retry_limit", sa.Integer(), nullable=False),
        sa.Column("input_schema", sa.JSON(), nullable=False),
        sa.Column("auth_config_encrypted", sa.Text(), nullable=False),
        sa.Column("response_config", sa.JSON(), nullable=False),
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("workspace_key", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["source_endpoint_id"], ["mcp_endpoints.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tool_slug"),
    )
    op.create_index(op.f("ix_tool_definitions_tool_slug"), "tool_definitions", ["tool_slug"], unique=False)
    op.create_index(op.f("ix_tool_definitions_workspace_key"), "tool_definitions", ["workspace_key"], unique=False)

    op.create_table(
        "agent_definitions",
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("slug", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("latest_version_id", sa.String(length=64), nullable=True),
        sa.Column("published_version_id", sa.String(length=64), nullable=True),
        sa.Column("owner_user_id", sa.String(length=128), nullable=False),
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("workspace_key", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )
    op.create_index(op.f("ix_agent_definitions_owner_user_id"), "agent_definitions", ["owner_user_id"], unique=False)
    op.create_index(op.f("ix_agent_definitions_slug"), "agent_definitions", ["slug"], unique=False)
    op.create_index(op.f("ix_agent_definitions_workspace_key"), "agent_definitions", ["workspace_key"], unique=False)

    op.create_table(
        "agent_versions",
        sa.Column("agent_id", sa.String(length=64), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("model_id", sa.String(length=255), nullable=True),
        sa.Column("system_prompt", sa.Text(), nullable=False),
        sa.Column("tool_ids", sa.JSON(), nullable=False),
        sa.Column("collection_ids", sa.JSON(), nullable=False),
        sa.Column("config_json", sa.JSON(), nullable=False),
        sa.Column("submitted_by_user_id", sa.String(length=128), nullable=True),
        sa.Column("approved_by_user_id", sa.String(length=128), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("workspace_key", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["agent_id"], ["agent_definitions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_agent_versions_agent_status", "agent_versions", ["agent_id", "status"], unique=False)
    op.create_index(op.f("ix_agent_versions_agent_id"), "agent_versions", ["agent_id"], unique=False)
    op.create_index(op.f("ix_agent_versions_workspace_key"), "agent_versions", ["workspace_key"], unique=False)

    op.create_foreign_key(None, "agent_definitions", "agent_versions", ["latest_version_id"], ["id"], ondelete="SET NULL")
    op.create_foreign_key(None, "agent_definitions", "agent_versions", ["published_version_id"], ["id"], ondelete="SET NULL")

    op.create_table(
        "agent_tool_bindings",
        sa.Column("agent_id", sa.String(length=64), nullable=False),
        sa.Column("tool_id", sa.String(length=64), nullable=False),
        sa.Column("approved", sa.Boolean(), nullable=False),
        sa.Column("approved_by_user_id", sa.String(length=128), nullable=True),
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("workspace_key", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["agent_id"], ["agent_definitions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tool_id"], ["tool_definitions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_agent_tool_bindings_agent_id"), "agent_tool_bindings", ["agent_id"], unique=False)
    op.create_index(op.f("ix_agent_tool_bindings_tool_id"), "agent_tool_bindings", ["tool_id"], unique=False)
    op.create_index(op.f("ix_agent_tool_bindings_workspace_key"), "agent_tool_bindings", ["workspace_key"], unique=False)

    op.create_table(
        "document_collections",
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("slug", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("allowed_agent_ids", sa.JSON(), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("workspace_key", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )
    op.create_index(op.f("ix_document_collections_slug"), "document_collections", ["slug"], unique=False)
    op.create_index(op.f("ix_document_collections_workspace_key"), "document_collections", ["workspace_key"], unique=False)

    op.create_table(
        "documents",
        sa.Column("collection_id", sa.String(length=64), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("blob_path", sa.String(length=1024), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("content_type", sa.String(length=255), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("chunk_count", sa.Integer(), nullable=False),
        sa.Column("indexed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("workspace_key", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["collection_id"], ["document_collections.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_documents_collection_status", "documents", ["collection_id", "status"], unique=False)
    op.create_index(op.f("ix_documents_workspace_key"), "documents", ["workspace_key"], unique=False)

    op.create_table(
        "document_chunks",
        sa.Column("document_id", sa.String(length=64), nullable=False),
        sa.Column("collection_id", sa.String(length=64), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("token_count", sa.Integer(), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("embedding", pgvector.sqlalchemy.Vector(dim=1536), nullable=True),
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("workspace_key", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["collection_id"], ["document_collections.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_chunks_collection_document", "document_chunks", ["collection_id", "document_id"], unique=False)
    op.create_index(op.f("ix_document_chunks_collection_id"), "document_chunks", ["collection_id"], unique=False)
    op.create_index(op.f("ix_document_chunks_document_id"), "document_chunks", ["document_id"], unique=False)
    op.create_index(op.f("ix_document_chunks_workspace_key"), "document_chunks", ["workspace_key"], unique=False)

    op.create_table(
        "routing_policies",
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("confidence_threshold", sa.Float(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("config_json", sa.JSON(), nullable=False),
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("workspace_key", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_index(op.f("ix_routing_policies_workspace_key"), "routing_policies", ["workspace_key"], unique=False)

    op.create_table(
        "agent_runs",
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("user_id", sa.String(length=128), nullable=False),
        sa.Column("session_id", sa.String(length=128), nullable=True),
        sa.Column("agent_id", sa.String(length=64), nullable=True),
        sa.Column("collection_id", sa.String(length=64), nullable=True),
        sa.Column("route_kind", sa.String(length=32), nullable=False),
        sa.Column("route_confidence", sa.Float(), nullable=True),
        sa.Column("resolved_model", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("input_text", sa.Text(), nullable=False),
        sa.Column("output_text", sa.Text(), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("workspace_key", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_agent_runs_agent_id"), "agent_runs", ["agent_id"], unique=False)
    op.create_index(op.f("ix_agent_runs_user_id"), "agent_runs", ["user_id"], unique=False)
    op.create_index(op.f("ix_agent_runs_workspace_key"), "agent_runs", ["workspace_key"], unique=False)

    op.create_table(
        "agent_run_steps",
        sa.Column("run_id", sa.String(length=64), nullable=False),
        sa.Column("step_type", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("workspace_key", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_agent_run_steps_run_id"), "agent_run_steps", ["run_id"], unique=False)
    op.create_index(op.f("ix_agent_run_steps_workspace_key"), "agent_run_steps", ["workspace_key"], unique=False)

    op.create_table(
        "audit_events",
        sa.Column("actor_user_id", sa.String(length=128), nullable=True),
        sa.Column("event_type", sa.String(length=128), nullable=False),
        sa.Column("target_type", sa.String(length=128), nullable=False),
        sa.Column("target_id", sa.String(length=64), nullable=True),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("workspace_key", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_audit_events_event_type"), "audit_events", ["event_type"], unique=False)
    op.create_index(op.f("ix_audit_events_workspace_key"), "audit_events", ["workspace_key"], unique=False)


def downgrade() -> None:
    op.drop_table("audit_events")
    op.drop_table("agent_run_steps")
    op.drop_table("agent_runs")
    op.drop_table("routing_policies")
    op.drop_table("document_chunks")
    op.drop_table("documents")
    op.drop_table("document_collections")
    op.drop_table("agent_tool_bindings")
    op.drop_table("agent_versions")
    op.drop_table("agent_definitions")
    op.drop_table("tool_definitions")
    op.drop_table("mcp_endpoints")
    op.drop_table("provider_credentials")
    op.drop_table("model_providers")
    op.drop_table("workspace_members")
