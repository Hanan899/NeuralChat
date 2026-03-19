import json
import os
from unittest.mock import AsyncMock, MagicMock, patch

from azure.core.exceptions import ResourceNotFoundError
from fastapi.testclient import TestClient

os.environ.setdefault("NEURALCHAT_STORAGE_MODE", "memory")

from app.auth import require_user_id
from app.main import app, run_project_brain
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


def _mock_http_client(response_body: dict[str, object]) -> tuple[MagicMock, MagicMock]:
    client_mock = MagicMock()
    response_mock = MagicMock()
    response_mock.json.return_value = response_body
    response_mock.raise_for_status.return_value = None
    client_mock.post.return_value = response_mock
    context_manager = MagicMock()
    context_manager.__enter__.return_value = client_mock
    context_manager.__exit__.return_value = None
    return context_manager, client_mock


def _project_storage() -> dict[str, str]:
    return {
        "projects/ali-khan__user1/neuralchat__proj1/meta.json": json.dumps(
            {
                "project_id": "proj1",
                "user_id": "user1",
                "name": "NeuralChat",
                "template": "startup",
                "system_prompt": "You are my startup advisor.",
            }
        ),
        "projects/ali-khan__user1/index.json": json.dumps(
            [
                {
                    "project_id": "proj1",
                    "user_id": "user1",
                    "name": "NeuralChat",
                    "template": "startup",
                    "system_prompt": "You are my startup advisor.",
                    "updated_at": "2026-03-19T10:00:00+00:00",
                    "pinned": False,
                }
            ]
        ),
    }


def test_returns_correct_keys_for_startup_template():
    assert projects.get_template_memory_keys("startup") == [
        "startup_name",
        "tech_stack",
        "target_users",
        "business_model",
        "stage",
    ]


def test_returns_empty_keys_for_custom_and_unknown_templates():
    assert projects.get_template_memory_keys("custom") == []
    assert projects.get_template_memory_keys("nonexistent") == []


def test_extract_facts_returns_relevant_facts_for_template():
    context_manager, _ = _mock_http_client(
        {
            "choices": [{"message": {"content": '{"startup_name": "NeuralChat", "tech_stack": "FastAPI"}'}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5},
        }
    )

    with (
        patch("app.services.projects.httpx.Client", return_value=context_manager),
        patch.dict(
            os.environ,
            {
                "AZURE_OPENAI_ENDPOINT": "https://example.openai.azure.com",
                "AZURE_OPENAI_API_KEY": "secret",
                "AZURE_OPENAI_DEPLOYMENT_NAME": "gpt-5",
            },
            clear=False,
        ),
    ):
        facts = projects.extract_project_facts(
            "We are building NeuralChat",
            "That sounds promising.",
            "startup",
            {"startup_name": "Old"},
        )

    assert facts == {"startup_name": "NeuralChat", "tech_stack": "FastAPI"}


def test_extract_facts_returns_empty_on_no_relevant_or_malformed_json():
    empty_context_manager, _ = _mock_http_client(
        {"choices": [{"message": {"content": "{}"}}], "usage": {"prompt_tokens": 10, "completion_tokens": 5}}
    )
    malformed_context_manager, _ = _mock_http_client(
        {"choices": [{"message": {"content": "Sure, I found some facts."}}], "usage": {"prompt_tokens": 10, "completion_tokens": 5}}
    )

    with (
        patch("app.services.projects.httpx.Client", return_value=empty_context_manager),
        patch.dict(
            os.environ,
            {
                "AZURE_OPENAI_ENDPOINT": "https://example.openai.azure.com",
                "AZURE_OPENAI_API_KEY": "secret",
                "AZURE_OPENAI_DEPLOYMENT_NAME": "gpt-5",
            },
            clear=False,
        ),
    ):
        assert projects.extract_project_facts("message", "reply", "startup", {}) == {}

    with (
        patch("app.services.projects.httpx.Client", return_value=malformed_context_manager),
        patch.dict(
            os.environ,
            {
                "AZURE_OPENAI_ENDPOINT": "https://example.openai.azure.com",
                "AZURE_OPENAI_API_KEY": "secret",
                "AZURE_OPENAI_DEPLOYMENT_NAME": "gpt-5",
            },
            clear=False,
        ),
    ):
        assert projects.extract_project_facts("message", "reply", "startup", {}) == {}


def test_extract_facts_prompt_includes_template_keys_and_existing_memory():
    context_manager, client_mock = _mock_http_client(
        {"choices": [{"message": {"content": "{}"}}], "usage": {"prompt_tokens": 10, "completion_tokens": 5}}
    )

    with (
        patch("app.services.projects.httpx.Client", return_value=context_manager),
        patch.dict(
            os.environ,
            {
                "AZURE_OPENAI_ENDPOINT": "https://example.openai.azure.com",
                "AZURE_OPENAI_API_KEY": "secret",
                "AZURE_OPENAI_DEPLOYMENT_NAME": "gpt-5",
            },
            clear=False,
        ),
    ):
        projects.extract_project_facts("message", "reply", "startup", {"startup_name": "NeuralChat"})

    request_payload = client_mock.post.call_args.kwargs["json"]
    system_prompt = request_payload["messages"][0]["content"]
    assert "startup_name" in system_prompt
    assert "tech_stack" in system_prompt
    assert "NeuralChat" in system_prompt


def test_save_project_memory_merges_values_updates_timestamp_and_appends_audit_trail():
    memory_storage = _project_storage()
    memory_storage["projects/ali-khan__user1/neuralchat__proj1/memory.json"] = json.dumps({"startup_name": "NeuralChat"})

    with patch("app.services.projects._get_memory_container", return_value=FakeContainer(memory_storage)):
        projects.save_project_memory("user1", "proj1", {"tech_stack": "FastAPI"}, "Ali Khan")
        projects.save_project_memory("user1", "proj1", {"startup_name": "NeuralChat OS"}, "Ali Khan")

    saved_memory = json.loads(memory_storage["projects/ali-khan__user1/neuralchat__proj1/memory.json"])
    assert saved_memory["startup_name"] == "NeuralChat OS"
    assert saved_memory["tech_stack"] == "FastAPI"
    assert "last_updated" in saved_memory
    assert len(saved_memory["_raw_facts"]) == 2


def test_get_memory_completeness_returns_expected_percentage_and_suggestion():
    completeness = projects.get_memory_completeness(
        {
            "startup_name": "NeuralChat",
            "tech_stack": "FastAPI",
            "target_users": "AI developers",
        },
        "startup",
    )

    assert completeness["percentage"] == 60
    assert completeness["filled_keys"] == ["startup_name", "tech_stack", "target_users"]
    assert completeness["missing_keys"] == ["business_model", "stage"]
    assert "business model" in completeness["suggestion"].lower()


def test_get_memory_completeness_returns_100_for_custom_template():
    assert projects.get_memory_completeness({}, "custom") == {
        "percentage": 100,
        "filled_keys": [],
        "missing_keys": [],
        "suggestion": "",
    }


def test_log_brain_extraction_creates_and_trims_log():
    memory_storage = _project_storage()
    existing_log = [
        {
            "timestamp": f"2026-03-19T10:{index:02d}:00+00:00",
            "session_id": f"chat-{index}",
            "extracted_facts": {"tech_stack": "FastAPI"},
            "tokens_used": 20,
        }
        for index in range(100)
    ]
    memory_storage["projects/ali-khan__user1/neuralchat__proj1/brain_log.json"] = json.dumps(existing_log)

    with patch("app.services.projects._get_memory_container", return_value=FakeContainer(memory_storage)):
        projects.log_brain_extraction("user1", "proj1", "chat-101", {"startup_name": "NeuralChat"}, 30, "Ali Khan")

    saved_log = json.loads(memory_storage["projects/ali-khan__user1/neuralchat__proj1/brain_log.json"])
    assert len(saved_log) == 100
    assert saved_log[-1]["session_id"] == "chat-101"


def test_clear_project_memory_resets_memory_and_brain_log():
    memory_storage = _project_storage()
    memory_storage["projects/ali-khan__user1/neuralchat__proj1/memory.json"] = json.dumps({"startup_name": "NeuralChat"})
    memory_storage["projects/ali-khan__user1/neuralchat__proj1/brain_log.json"] = json.dumps([{"timestamp": "x"}])

    with patch("app.services.projects._get_memory_container", return_value=FakeContainer(memory_storage)):
        projects.clear_project_memory("user1", "proj1", "Ali Khan")

    assert json.loads(memory_storage["projects/ali-khan__user1/neuralchat__proj1/memory.json"]) == {}
    assert json.loads(memory_storage["projects/ali-khan__user1/neuralchat__proj1/brain_log.json"]) == []


def test_run_project_brain_saves_memory_when_facts_extracted():
    import asyncio

    async def exercise():
        with (
            patch("app.main.load_project_memory", return_value={}),
            patch("app.main.extract_project_facts_with_usage", return_value=({"startup_name": "NeuralChat"}, {"input_tokens": 10, "output_tokens": 5})),
            patch("app.main.log_usage") as log_usage_mock,
            patch("app.main.save_project_memory") as save_memory_mock,
            patch("app.main.log_brain_extraction") as log_brain_mock,
        ):
            await run_project_brain("user1", "proj1", "chat-1", "hello", "reply", "startup", "Ali Khan")
        save_memory_mock.assert_called_once_with("user1", "proj1", {"startup_name": "NeuralChat"}, "Ali Khan")
        log_brain_mock.assert_called_once()
        log_usage_mock.assert_called_once_with("user1", "memory", 10, 5, "Ali Khan")

    asyncio.run(exercise())


def test_run_project_brain_does_nothing_when_no_facts_extracted():
    import asyncio

    async def exercise():
        with (
            patch("app.main.load_project_memory", return_value={}),
            patch("app.main.extract_project_facts_with_usage", return_value=({}, {"input_tokens": 10, "output_tokens": 5})),
            patch("app.main.save_project_memory") as save_memory_mock,
            patch("app.main.log_brain_extraction") as log_brain_mock,
        ):
            await run_project_brain("user1", "proj1", "chat-1", "hello", "reply", "startup", "Ali Khan")
        save_memory_mock.assert_not_called()
        log_brain_mock.assert_not_called()

    asyncio.run(exercise())


def test_run_project_brain_does_not_crash_on_exception():
    import asyncio

    async def exercise():
        with patch("app.main.load_project_memory", side_effect=Exception("boom")):
            await run_project_brain("user1", "proj1", "chat-1", "hello", "reply", "startup", "Ali Khan")

    asyncio.run(exercise())


def test_get_memory_returns_memory_and_completeness():
    app.dependency_overrides[require_user_id] = lambda: "user1"
    with (
        patch("app.main.get_project", return_value={"project_id": "proj1", "template": "startup"}),
        patch("app.main.load_project_memory", return_value={"startup_name": "NeuralChat"}),
        patch(
            "app.main.get_memory_completeness",
            return_value={"percentage": 20, "filled_keys": ["startup_name"], "missing_keys": ["tech_stack"], "suggestion": "Tell me about your tech stack."},
        ),
    ):
        response = client.get("/api/projects/proj1/memory")
    app.dependency_overrides.pop(require_user_id, None)

    assert response.status_code == 200
    payload = response.json()
    assert payload["memory"] == {"startup_name": "NeuralChat"}
    assert payload["completeness"]["percentage"] == 20


def test_patch_memory_updates_one_fact():
    app.dependency_overrides[require_user_id] = lambda: "user1"
    with (
        patch("app.main.get_project", return_value={"project_id": "proj1", "template": "startup"}),
        patch("app.main.save_project_memory") as save_memory_mock,
        patch("app.main.load_project_memory", return_value={"tech_stack": "FastAPI"}),
    ):
        response = client.patch("/api/projects/proj1/memory", json={"key": "tech_stack", "value": "FastAPI"})
    app.dependency_overrides.pop(require_user_id, None)

    assert response.status_code == 200
    save_memory_mock.assert_called_once_with("user1", "proj1", {"tech_stack": "FastAPI"}, None)
    assert response.json()["memory"] == {"tech_stack": "FastAPI"}


def test_delete_memory_resets_brain():
    app.dependency_overrides[require_user_id] = lambda: "user1"
    with (
        patch("app.main.get_project", return_value={"project_id": "proj1", "template": "startup"}),
        patch("app.main.clear_project_memory") as clear_memory_mock,
    ):
        response = client.delete("/api/projects/proj1/memory")
    app.dependency_overrides.pop(require_user_id, None)

    assert response.status_code == 200
    clear_memory_mock.assert_called_once_with("user1", "proj1", None)
    assert response.json() == {"message": "Project Brain reset"}


def test_get_brain_log_returns_last_20_entries():
    app.dependency_overrides[require_user_id] = lambda: "user1"
    brain_log = [
        {
            "timestamp": f"2026-03-19T10:{index:02d}:00+00:00",
            "session_id": f"chat-{index}",
            "extracted_facts": {"tech_stack": "FastAPI"},
            "tokens_used": 20,
        }
        for index in range(30)
    ]
    with (
        patch("app.main.get_project", return_value={"project_id": "proj1", "template": "startup"}),
        patch("app.main.get_brain_log", return_value=brain_log),
    ):
        response = client.get("/api/projects/proj1/brain-log")
    app.dependency_overrides.pop(require_user_id, None)

    assert response.status_code == 200
    assert len(response.json()["log"]) == 20


def test_chat_triggers_brain_extraction_in_background_for_project_chat():
    app.dependency_overrides[require_user_id] = lambda: "user1"
    create_task_mock = MagicMock(side_effect=_close_background_coroutine)

    with (
        patch("app.main.get_project", return_value={"project_id": "proj1", "name": "NeuralChat", "template": "startup"}),
        patch("app.main.load_project_chat_messages", return_value=[]),
        patch("app.main.append_project_chat_message"),
        patch("app.main.build_project_system_prompt", return_value="Project prompt"),
        patch("app.main.generate_reply_with_usage", new=AsyncMock(return_value=("Project reply", {"input_tokens": 10, "output_tokens": 20}))),
        patch("app.main.run_project_brain", new=AsyncMock()) as run_project_brain_mock,
        patch("app.main.asyncio.create_task", side_effect=create_task_mock),
        patch("app.main.build_memory_prompt") as build_memory_prompt_mock,
    ):
        response = client.post(
            "/api/chat",
            json={
                "session_id": "chat-1",
                "message": "Help with pricing",
                "model": "gpt-5",
                "stream": False,
                "project_id": "proj1",
            },
            headers={"X-User-Display-Name": "Ali Khan", "X-Session-Title": "NeuralChat"},
        )
    app.dependency_overrides.pop(require_user_id, None)

    assert response.status_code == 200
    run_project_brain_mock.assert_called_once()
    build_memory_prompt_mock.assert_not_called()
