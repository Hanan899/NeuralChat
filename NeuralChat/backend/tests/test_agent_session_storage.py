import os

os.environ.setdefault("NEURALCHAT_STORAGE_MODE", "memory")

from app.services import storage


def test_list_conversation_summaries_preserves_agent_workspace_kind():
    store = {"mode": "memory"}
    storage._MEMORY_STORE.clear()
    try:
        storage.append_message(
            store,
            "user_123",
            "session-agent",
            {
                "role": "user",
                "content": "Research deployment plan",
                "workspace_kind": "agent",
            },
        )
        storage.append_message(
            store,
            "user_123",
            "session-agent",
            {
                "role": "assistant",
                "content": "Agent plan ready: 3 steps",
                "workspace_kind": "agent",
            },
        )

        summaries = storage.list_conversation_summaries(store, "user_123")

        assert len(summaries) == 1
        assert summaries[0]["id"] == "session-agent"
        assert summaries[0]["workspaceKind"] == "agent"
        assert summaries[0]["preview"] == "Agent plan ready: 3 steps"
    finally:
        storage._MEMORY_STORE.clear()


def test_upsert_message_replaces_existing_agent_snapshot_by_request_id():
    store = {"mode": "memory"}
    storage._MEMORY_STORE.clear()
    try:
        storage.append_message(
            store,
            "user_123",
            "session-agent",
            {
                "role": "assistant",
                "content": "Agent plan ready: 2 steps",
                "request_id": "plan-1",
                "workspace_kind": "agent",
                "agent_task": {"status": "preview", "plan": {"plan_id": "plan-1", "goal": "Goal", "steps": []}},
            },
        )

        storage.upsert_message(
            store,
            "user_123",
            "session-agent",
            {
                "role": "assistant",
                "content": "Agent task completed",
                "request_id": "plan-1",
                "workspace_kind": "agent",
                "agent_task": {"status": "completed", "plan": {"plan_id": "plan-1", "goal": "Goal", "steps": []}},
            },
        )

        messages = storage.load_messages(store, "user_123", "session-agent")

        assert len(messages) == 1
        assert messages[0]["content"] == "Agent task completed"
        assert messages[0]["agent_task"]["status"] == "completed"
    finally:
        storage._MEMORY_STORE.clear()
