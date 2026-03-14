import json
import os
from unittest.mock import patch

from azure.core.exceptions import ResourceNotFoundError
from fastapi.testclient import TestClient

os.environ.setdefault("NEURALCHAT_STORAGE_MODE", "memory")

from app.auth import require_user_id
from app.main import app
from app.services import agent, storage


class FakeBlobClient:
    def __init__(self, storage_map: dict[str, str], blob_name: str):
        self.storage_map = storage_map
        self.blob_name = blob_name

    def upload_blob(self, data, overwrite=False, content_type=None):
        self.storage_map[self.blob_name] = data.decode("utf-8") if isinstance(data, bytes) else str(data)

    def download_blob(self):
        if self.blob_name not in self.storage_map:
            raise ResourceNotFoundError("missing")

        class Reader:
            def __init__(self, value: str):
                self.value = value

            def readall(self):
                return self.value.encode("utf-8")

        return Reader(self.storage_map[self.blob_name])

    def delete_blob(self, delete_snapshots=None):
        if self.blob_name not in self.storage_map:
            raise ResourceNotFoundError("missing")
        del self.storage_map[self.blob_name]


class FakeContainer:
    def __init__(self, storage_map: dict[str, str]):
        self.storage_map = storage_map

    def get_blob_client(self, blob: str):
        return FakeBlobClient(self.storage_map, blob)

    def list_blobs(self, name_starts_with: str = ""):
        for name in list(sorted(self.storage_map)):
            if name.startswith(name_starts_with):
                yield type("BlobItem", (), {"name": name, "last_modified": None})()


client = TestClient(app)


def test_delete_conversation_session_removes_memory_store_entry():
    store = {"mode": "memory"}
    storage.append_message(store, "user_123", "session-1", {"role": "user", "content": "hello"})

    deleted = storage.delete_conversation_session(store, "user_123", "session-1")

    assert deleted is True
    assert storage.load_messages(store, "user_123", "session-1") == []


def test_delete_session_agent_artifacts_removes_session_plan_and_log():
    container = FakeContainer(
        {
            "user__user_123/chat__session-1/plans/plan-1.json": json.dumps(
                {"plan_id": "plan-1", "goal": "Goal", "session_id": "session-1"}
            ),
            "user__user_123/chat__session-1/logs/plan-1.json": json.dumps(
                {"plan_id": "plan-1", "session_id": "session-1", "log": []}
            ),
            "user__user_123/chat__session-2/plans/plan-2.json": json.dumps(
                {"plan_id": "plan-2", "goal": "Other", "session_id": "session-2"}
            ),
        }
    )

    with patch("app.services.agent._get_agents_container", return_value=container):
        result = agent.delete_session_agent_artifacts("user_123", "session-1")

    assert result == {"plans_deleted": 1, "logs_deleted": 1}
    assert "user__user_123/chat__session-1/plans/plan-1.json" not in container.storage_map
    assert "user__user_123/chat__session-1/logs/plan-1.json" not in container.storage_map
    assert "user__user_123/chat__session-2/plans/plan-2.json" in container.storage_map


def test_delete_conversation_endpoint_calls_all_cleanup_helpers():
    app.dependency_overrides[require_user_id] = lambda: "user_123"
    with (
        patch("app.main.delete_conversation_session", return_value=True) as delete_conversation_mock,
        patch("app.main.delete_session_files", return_value={"uploads_deleted": 2, "parsed_deleted": 2}) as delete_files_mock,
        patch("app.main.delete_session_agent_artifacts", return_value={"plans_deleted": 1, "logs_deleted": 1}) as delete_agents_mock,
    ):
        response = client.delete(
            "/api/conversations/session-1",
            headers={
                "X-User-Display-Name": "Abdul Hanan",
                "X-Session-Title": "Roadmap Review",
            },
        )
    app.dependency_overrides.pop(require_user_id, None)

    assert response.status_code == 200
    assert response.json()["conversation_deleted"] is True
    assert response.json()["uploads_deleted"] == 2
    delete_conversation_mock.assert_called_once()
    delete_files_mock.assert_called_once()
    delete_agents_mock.assert_called_once()
