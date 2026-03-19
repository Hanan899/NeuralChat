import json
import os
from unittest.mock import AsyncMock, MagicMock, patch

from azure.core.exceptions import ResourceNotFoundError
from fastapi.testclient import TestClient

os.environ.setdefault("NEURALCHAT_STORAGE_MODE", "memory")

from app.auth import require_user_id
from app.main import app
from app.services import projects


class FakeBlobClient:
    def __init__(self, storage_map: dict[str, str], blob_name: str):
        self.storage_map = storage_map
        self.blob_name = blob_name

    def upload_blob(self, data, overwrite=False, content_type=None):
        if isinstance(data, bytes):
            payload = data.decode("utf-8")
        else:
            payload = str(data)
        self.storage_map[self.blob_name] = payload

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

    def create_container(self):
        return None

    def get_blob_client(self, blob: str):
        return FakeBlobClient(self.storage_map, blob)

    def list_blobs(self, name_starts_with: str = ""):
        for name in sorted(self.storage_map):
            if name.startswith(name_starts_with):
                yield type("BlobItem", (), {"name": name, "last_modified": None})()


client = TestClient(app)


def _close_background_coroutine(coroutine):
    coroutine.close()
    return MagicMock()


def test_create_project_returns_valid_dict():
    memory_storage: dict[str, str] = {}
    memory_container = FakeContainer(memory_storage)

    with patch("app.services.projects._get_memory_container", return_value=memory_container):
        project = projects.create_project("user1", "My Startup", "startup", display_name="Ali Khan")

    assert project["name"] == "My Startup"
    assert project["emoji"] == "🚀"
    assert project["color"] == "#6366f1"
    assert "startup advisor" in project["system_prompt"].lower()
    assert "projects/ali-khan__user1/index.json" in memory_storage
    assert project["project_id"]


def test_create_project_initializes_empty_memory_and_appends_to_index():
    memory_storage = {
        "projects/ali-khan__user1/index.json": json.dumps(
            [
                {
                    "project_id": "existing-project",
                    "user_id": "user1",
                    "name": "Existing",
                    "description": "",
                    "emoji": "📚",
                    "template": "study",
                    "color": "#10b981",
                    "system_prompt": "Study prompt",
                    "created_at": "2026-03-17T10:00:00+00:00",
                    "updated_at": "2026-03-17T10:00:00+00:00",
                    "chat_count": 0,
                    "pinned": False,
                }
            ]
        )
    }
    memory_container = FakeContainer(memory_storage)

    with patch("app.services.projects._get_memory_container", return_value=memory_container):
        project = projects.create_project("user1", "Second Project", "custom", display_name="Ali Khan")

    saved_index = json.loads(memory_storage["projects/ali-khan__user1/index.json"])
    assert len(saved_index) == 2
    assert memory_storage[f"projects/ali-khan__user1/{project['name'].lower().replace(' ', '-') }__{project['project_id']}/memory.json"] == "{}"


def test_create_project_raises_on_invalid_name():
    memory_container = FakeContainer({})
    with patch("app.services.projects._get_memory_container", return_value=memory_container):
        try:
            projects.create_project("user1", "", "startup")
            assert False, "Expected ValueError for empty name"
        except ValueError as error:
            assert "required" in str(error).lower()

        try:
            projects.create_project("user1", "x" * 51, "startup")
            assert False, "Expected ValueError for long name"
        except ValueError as error:
            assert "50 characters" in str(error)


def test_get_all_projects_returns_pinned_first():
    memory_storage = {
        "projects/ali-khan__user1/index.json": json.dumps(
            [
                {"project_id": "p2", "name": "Old", "pinned": False, "updated_at": "2026-03-15T10:00:00+00:00"},
                {"project_id": "p1", "name": "Pinned", "pinned": True, "updated_at": "2026-03-14T10:00:00+00:00"},
                {"project_id": "p3", "name": "Newest", "pinned": False, "updated_at": "2026-03-17T10:00:00+00:00"},
            ]
        )
    }
    with patch("app.services.projects._get_memory_container", return_value=FakeContainer(memory_storage)):
        results = projects.get_all_projects("user1", "Ali Khan")

    assert [project["project_id"] for project in results] == ["p1", "p3", "p2"]


def test_update_project_changes_name_but_not_project_id():
    memory_storage = {
        "projects/ali-khan__user1/my-startup__proj1/meta.json": json.dumps(
            {
                "project_id": "proj1",
                "user_id": "user1",
                "name": "My Startup",
                "description": "Desc",
                "emoji": "🚀",
                "template": "startup",
                "color": "#6366f1",
                "system_prompt": "Prompt",
                "created_at": "2026-03-17T10:00:00+00:00",
                "updated_at": "2026-03-17T10:00:00+00:00",
                "chat_count": 0,
                "pinned": False,
            }
        ),
        "projects/ali-khan__user1/index.json": json.dumps(
            [
                {
                    "project_id": "proj1",
                    "user_id": "user1",
                    "name": "My Startup",
                    "description": "Desc",
                    "emoji": "🚀",
                    "template": "startup",
                    "color": "#6366f1",
                    "system_prompt": "Prompt",
                    "created_at": "2026-03-17T10:00:00+00:00",
                    "updated_at": "2026-03-17T10:00:00+00:00",
                    "chat_count": 0,
                    "pinned": False,
                }
            ]
        ),
    }
    memory_container = FakeContainer(memory_storage)
    uploads_container = FakeContainer({})
    parsed_container = FakeContainer({})

    with (
        patch("app.services.projects._get_memory_container", return_value=memory_container),
        patch("app.services.projects._get_uploads_container", return_value=uploads_container),
        patch("app.services.projects._get_parsed_container", return_value=parsed_container),
    ):
        updated = projects.update_project("user1", "proj1", {"name": "New Name", "project_id": "hacked"}, "Ali Khan")

    assert updated["name"] == "New Name"
    assert updated["project_id"] == "proj1"
    assert "projects/ali-khan__user1/new-name__proj1/meta.json" in memory_storage


def test_delete_project_removes_all_nested_blobs_and_updates_index():
    memory_storage = {
        "projects/ali-khan__user1/index.json": json.dumps(
            [
                {"project_id": "proj1", "user_id": "user1", "name": "Delete Me", "updated_at": "2026-03-17T10:00:00+00:00", "pinned": False},
                {"project_id": "proj2", "user_id": "user1", "name": "Keep Me", "updated_at": "2026-03-17T11:00:00+00:00", "pinned": False},
            ]
        ),
        "projects/ali-khan__user1/delete-me__proj1/meta.json": json.dumps({"project_id": "proj1", "user_id": "user1", "name": "Delete Me"}),
        "projects/ali-khan__user1/delete-me__proj1/memory.json": json.dumps({}),
        "projects/ali-khan__user1/delete-me__proj1/chats/chat__chat1.json": json.dumps([]),
    }
    uploads_storage = {"projects/ali-khan__user1/delete-me__proj1/files/doc.txt": "hello"}
    parsed_storage = {"projects/ali-khan__user1/delete-me__proj1/files_parsed/doc.txt.json": json.dumps({"chunks": ["hello"]})}

    with (
        patch("app.services.projects._get_memory_container", return_value=FakeContainer(memory_storage)),
        patch("app.services.projects._get_uploads_container", return_value=FakeContainer(uploads_storage)),
        patch("app.services.projects._get_parsed_container", return_value=FakeContainer(parsed_storage)),
    ):
        projects.delete_project("user1", "proj1", "Ali Khan")

    assert all("proj1" not in key for key in memory_storage)
    assert all("proj1" not in key for key in uploads_storage)
    assert all("proj1" not in key for key in parsed_storage)
    saved_index = json.loads(memory_storage["projects/ali-khan__user1/index.json"])
    assert len(saved_index) == 1
    assert saved_index[0]["project_id"] == "proj2"


def test_save_project_memory_merges_facts_and_build_prompt_includes_memory():
    memory_storage = {
        "projects/ali-khan__user1/neuralchat__proj1/meta.json": json.dumps(
            {
                "project_id": "proj1",
                "user_id": "user1",
                "name": "NeuralChat",
                "template": "startup",
                "system_prompt": "You are a dedicated startup advisor for this project.",
            }
        ),
        "projects/ali-khan__user1/index.json": json.dumps(
            [{"project_id": "proj1", "user_id": "user1", "name": "NeuralChat", "template": "startup", "system_prompt": "You are a dedicated startup advisor for this project.", "updated_at": "2026-03-17T10:00:00+00:00", "pinned": False}]
        ),
        "projects/ali-khan__user1/neuralchat__proj1/memory.json": json.dumps({"startup_name": "NeuralChat"}),
    }
    memory_container = FakeContainer(memory_storage)

    with patch("app.services.projects._get_memory_container", return_value=memory_container):
        projects.save_project_memory("user1", "proj1", {"tech_stack": "FastAPI"}, "Ali Khan")
        prompt = projects.build_project_system_prompt("user1", "proj1", "Ali Khan")

    saved_memory = json.loads(memory_storage["projects/ali-khan__user1/neuralchat__proj1/memory.json"])
    assert saved_memory["startup_name"] == "NeuralChat"
    assert saved_memory["tech_stack"] == "FastAPI"
    assert "startup_name: NeuralChat" in prompt
    assert "tech_stack: FastAPI" in prompt


def test_get_templates_returns_all_expected_templates():
    response = client.get("/api/projects/templates")

    assert response.status_code == 200
    payload = response.json()
    assert set(["startup", "study", "code", "writing", "research", "job", "custom"]).issubset(payload.keys())


def test_post_project_creates_and_returns_project():
    app.dependency_overrides[require_user_id] = lambda: "user1"
    with patch("app.main.create_project", return_value={"project_id": "proj1", "name": "Test", "template": "code"}):
        response = client.post("/api/projects", json={"name": "Test", "template": "code"})
    app.dependency_overrides.pop(require_user_id, None)

    assert response.status_code == 200
    assert response.json()["project_id"] == "proj1"


def test_delete_project_endpoint_success():
    app.dependency_overrides[require_user_id] = lambda: "user1"
    with patch("app.main.delete_project", return_value=None):
        response = client.delete("/api/projects/proj1")
    app.dependency_overrides.pop(require_user_id, None)

    assert response.status_code == 200
    assert response.json() == {"message": "Project deleted"}


def test_chat_with_project_id_uses_project_system_prompt_and_project_storage():
    app.dependency_overrides[require_user_id] = lambda: "user1"
    create_task_mock = MagicMock(side_effect=_close_background_coroutine)

    with (
        patch("app.main.get_project", return_value={"project_id": "proj1", "name": "NeuralChat", "template": "startup"}) as get_project_mock,
        patch("app.main.load_project_chat_messages", return_value=[]) as load_project_chat_messages_mock,
        patch("app.main.append_project_chat_message") as append_project_chat_message_mock,
        patch("app.main.build_project_system_prompt", return_value="Project prompt") as build_project_system_prompt_mock,
        patch("app.main.generate_reply_with_usage", new=AsyncMock(return_value=("Project reply", {"input_tokens": 10, "output_tokens": 20}))) as generate_reply_with_usage_mock,
        patch("app.main.run_project_brain", new=AsyncMock()) as run_project_brain_mock,
        patch("app.main.asyncio.create_task", side_effect=create_task_mock),
        patch("app.main.build_memory_prompt") as build_memory_prompt_mock,
        patch("app.main.save_user_message") as save_user_message_mock,
        patch("app.main.save_assistant_message") as save_assistant_message_mock,
    ):
        response = client.post(
            "/api/chat",
            json={
                "session_id": "chat-1",
                "message": "Help with my startup",
                "model": "gpt-5",
                "stream": False,
                "project_id": "proj1",
            },
            headers={"X-User-Display-Name": "Ali Khan", "X-Session-Title": "NeuralChat"},
        )
    app.dependency_overrides.pop(require_user_id, None)

    assert response.status_code == 200
    get_project_mock.assert_called_once()
    load_project_chat_messages_mock.assert_called_once()
    build_project_system_prompt_mock.assert_called_once_with("user1", "proj1", "Ali Khan")
    assert append_project_chat_message_mock.call_count == 2
    build_memory_prompt_mock.assert_not_called()
    save_user_message_mock.assert_not_called()
    save_assistant_message_mock.assert_not_called()
    run_project_brain_mock.assert_called_once()
    generate_reply_with_usage_mock.assert_awaited_once()


def test_chat_without_project_id_uses_global_memory_path():
    app.dependency_overrides[require_user_id] = lambda: "user1"
    create_task_mock = MagicMock(side_effect=_close_background_coroutine)

    with (
        patch("app.main.build_memory_prompt", return_value="Global prompt") as build_memory_prompt_mock,
        patch("app.main.save_user_message") as save_user_message_mock,
        patch("app.main.save_assistant_message") as save_assistant_message_mock,
        patch("app.main.generate_reply_with_usage", new=AsyncMock(return_value=("Global reply", {"input_tokens": 5, "output_tokens": 7}))),
        patch("app.main.process_memory_update", new=AsyncMock()) as process_memory_update_mock,
        patch("app.main.asyncio.create_task", side_effect=create_task_mock),
        patch("app.main.build_project_system_prompt") as build_project_system_prompt_mock,
    ):
        response = client.post(
            "/api/chat",
            json={"session_id": "chat-1", "message": "Hello", "model": "gpt-5", "stream": False},
            headers={"X-User-Display-Name": "Ali Khan", "X-Session-Title": "New chat"},
        )
    app.dependency_overrides.pop(require_user_id, None)

    assert response.status_code == 200
    build_memory_prompt_mock.assert_called_once_with(user_id="user1", display_name="Ali Khan")
    save_user_message_mock.assert_called_once()
    save_assistant_message_mock.assert_called_once()
    process_memory_update_mock.assert_called_once()
    build_project_system_prompt_mock.assert_not_called()
