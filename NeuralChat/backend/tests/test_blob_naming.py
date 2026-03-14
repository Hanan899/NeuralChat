import json
import os
from unittest.mock import patch

from azure.core.exceptions import ResourceNotFoundError

os.environ.setdefault("NEURALCHAT_STORAGE_MODE", "memory")

from app.services import agent, file_handler, memory, storage
from app.services.blob_paths import session_segment, user_segment


class FakeBlobClient:
    def __init__(self, storage_map: dict[str, str], blob_name: str):
        self.storage_map = storage_map
        self.blob_name = blob_name

    def upload_blob(self, data, overwrite=False, content_type=None):
        if isinstance(data, bytes):
            self.storage_map[self.blob_name] = data.decode("utf-8")
        else:
            self.storage_map[self.blob_name] = str(data)

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
        for name in sorted(self.storage_map):
            if name.startswith(name_starts_with):
                yield type("BlobItem", (), {"name": name, "last_modified": None})()


def test_named_segments_include_readable_label_and_stable_id():
    assert user_segment("user_123", "Abdul Hanan") == "abdul-hanan__user_123"
    assert session_segment("session-abc", "Roadmap Review") == "roadmap-review__session-abc"


def test_storage_load_messages_migrates_legacy_conversation_blob():
    memory_container = FakeContainer(
        {
            "conversations/user_123/session-abc.json": json.dumps([{"role": "user", "content": "hello"}]),
        }
    )
    store = {"mode": "blob", "memory_container": memory_container, "profiles_container": FakeContainer({})}

    messages = storage.load_messages(store, "user_123", "session-abc", "Abdul Hanan", "Roadmap Review")

    assert messages == [{"role": "user", "content": "hello"}]
    assert "conversations/abdul-hanan__user_123/roadmap-review__session-abc.json" in memory_container.storage_map
    assert "conversations/user_123/session-abc.json" not in memory_container.storage_map


def test_memory_load_profile_migrates_legacy_profile_blob():
    profiles_container = FakeContainer(
        {
            "profiles/user_123.json": json.dumps({"city": "Lahore"}),
        }
    )

    with patch("app.services.memory._get_profiles_container", return_value=profiles_container):
        profile = memory.load_profile("user_123", "Abdul Hanan")

    assert profile["city"] == "Lahore"
    assert profile["user_id"] == "user_123"
    assert profile["display_name"] == "Abdul Hanan"
    assert "profiles/abdul-hanan__user_123.json" in profiles_container.storage_map
    assert "profiles/user_123.json" not in profiles_container.storage_map


def test_load_parsed_chunks_migrates_legacy_session_blob():
    parsed_container = FakeContainer(
        {
            "user_123/session-abc/report.pdf.json": json.dumps(
                {"filename": "report.pdf", "chunk_count": 1, "chunks": ["chunk one"]}
            )
        }
    )

    with patch("app.services.file_handler._get_parsed_container", return_value=parsed_container):
        chunks = file_handler.load_parsed_chunks("user_123", "session-abc", "report.pdf", "Abdul Hanan", "Roadmap Review")

    assert chunks == ["chunk one"]
    assert "abdul-hanan__user_123/roadmap-review__session-abc/report.pdf.json" in parsed_container.storage_map
    assert "user_123/session-abc/report.pdf.json" not in parsed_container.storage_map


def test_load_task_plan_migrates_legacy_agent_plan_blob():
    agents_container = FakeContainer(
        {
            "user_123/plans/plan-1.json": json.dumps(
                {
                    "plan_id": "plan-1",
                    "goal": "Research tools",
                    "steps": [],
                    "session_id": "session-abc",
                    "session_title": "Roadmap Review",
                }
            )
        }
    )

    with patch("app.services.agent._get_agents_container", return_value=agents_container):
        plan = agent.load_task_plan("user_123", "plan-1", "Abdul Hanan", "session-abc", "Roadmap Review")

    assert plan is not None
    assert plan["goal"] == "Research tools"
    assert "abdul-hanan__user_123/roadmap-review__session-abc/plans/plan-1.json" in agents_container.storage_map
    assert "user_123/plans/plan-1.json" not in agents_container.storage_map
