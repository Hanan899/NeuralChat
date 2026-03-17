import asyncio
import json
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from azure.core.exceptions import ResourceNotFoundError

os.environ.setdefault("NEURALCHAT_STORAGE_MODE", "memory")

from app.auth import require_user_id
from app.main import app, post_agent_plan, post_agent_run, post_chat, post_conversation_title
from app.services import cost_tracker, memory


class FakeBlobClient:
    def __init__(self, storage_map: dict[str, str], blob_name: str):
        self.storage_map = storage_map
        self.blob_name = blob_name
        self.uploads: list[tuple[str, bool, str | None]] = []

    def upload_blob(self, data, overwrite=False, content_type=None):
        if isinstance(data, bytes):
            payload = data.decode("utf-8")
        else:
            payload = str(data)
        self.storage_map[self.blob_name] = payload
        self.uploads.append((payload, overwrite, content_type))

    def download_blob(self):
        if self.blob_name not in self.storage_map:
            raise ResourceNotFoundError(self.blob_name)

        class Reader:
            def __init__(self, value: str):
                self.value = value

            def readall(self):
                return self.value.encode("utf-8")

        return Reader(self.storage_map[self.blob_name])

    def delete_blob(self, delete_snapshots=None):
        self.storage_map.pop(self.blob_name, None)


class FakeContainer:
    def __init__(self, storage_map: dict[str, str]):
        self.storage_map = storage_map
        self.created = False

    def create_container(self):
        self.created = True

    def get_blob_client(self, blob: str):
        return FakeBlobClient(self.storage_map, blob)

    def list_blobs(self, name_starts_with: str = ""):
        for name in sorted(self.storage_map):
            if name.startswith(name_starts_with):
                yield type("BlobItem", (), {"name": name})()


client = TestClient(app)


async def run_immediately(function, *args, **kwargs):
    return function(*args, **kwargs)


def schedule_and_capture(task_list: list[asyncio.Task]):
    def _schedule(coroutine):
        task = asyncio.get_running_loop().create_task(coroutine)
        task_list.append(task)
        return task

    return _schedule


def test_calculate_cost_returns_correct_value():
    assert cost_tracker.calculate_cost(1_000_000, 0) == 3.0


def test_calculate_cost_handles_output_tokens():
    assert cost_tracker.calculate_cost(0, 1_000_000) == 15.0


def test_calculate_cost_handles_small_numbers():
    assert cost_tracker.calculate_cost(500, 200) == 0.0045


def test_calculate_cost_returns_zero_for_zero_tokens():
    assert cost_tracker.calculate_cost(0, 0) == 0.0


@patch("app.services.cost_tracker._get_memory_container")
def test_log_usage_creates_new_daily_file_when_none_exists(get_memory_container_mock):
    container = FakeContainer({})
    get_memory_container_mock.return_value = container

    with patch("app.services.cost_tracker.datetime") as datetime_mock:
        datetime_mock.now.return_value = MagicMock(
            date=MagicMock(return_value=MagicMock(isoformat=MagicMock(return_value="2026-03-17"))),
            replace=MagicMock(return_value=MagicMock(isoformat=MagicMock(return_value="2026-03-17T14:23:00+00:00"))),
        )
        cost_tracker.log_usage("user1", "chat", 500, 200, "Ali Khan")

    saved_records = json.loads(container.storage_map["usage/ali-khan__user1/2026-03-17.json"])
    assert len(saved_records) == 1
    assert saved_records[0]["feature"] == "chat"
    assert saved_records[0]["input_tokens"] == 500
    assert saved_records[0]["cost_usd"] > 0


@patch("app.services.cost_tracker._get_memory_container")
def test_log_usage_appends_to_existing_daily_file(get_memory_container_mock):
    container = FakeContainer(
        {
            "usage/user__user1/2026-03-17.json": json.dumps(
                [{"timestamp": "2026-03-17T10:00:00", "feature": "chat", "input_tokens": 100, "output_tokens": 20, "cost_usd": 0.0006}]
            )
        }
    )
    get_memory_container_mock.return_value = container

    with patch("app.services.cost_tracker.datetime") as datetime_mock:
        datetime_mock.now.return_value = MagicMock(
            date=MagicMock(return_value=MagicMock(isoformat=MagicMock(return_value="2026-03-17"))),
            replace=MagicMock(return_value=MagicMock(isoformat=MagicMock(return_value="2026-03-17T14:23:00+00:00"))),
        )
        cost_tracker.log_usage("user1", "chat", 300, 100)

    saved_records = json.loads(container.storage_map["usage/user__user1/2026-03-17.json"])
    assert len(saved_records) == 2


@patch("app.services.cost_tracker._get_memory_container")
def test_log_usage_saves_to_correct_blob_path(get_memory_container_mock):
    container = FakeContainer({})
    get_memory_container_mock.return_value = container

    with patch("app.services.cost_tracker.datetime") as datetime_mock:
        datetime_mock.now.return_value = MagicMock(
            date=MagicMock(return_value=MagicMock(isoformat=MagicMock(return_value="2026-03-17"))),
            replace=MagicMock(return_value=MagicMock(isoformat=MagicMock(return_value="2026-03-17T14:23:00+00:00"))),
        )
        cost_tracker.log_usage("user1", "memory", 100, 50)

    assert "usage/user__user1/2026-03-17.json" in container.storage_map


@patch("app.services.cost_tracker._get_memory_container")
def test_log_usage_includes_correct_feature_label(get_memory_container_mock):
    container = FakeContainer({})
    get_memory_container_mock.return_value = container

    with patch("app.services.cost_tracker.datetime") as datetime_mock:
        datetime_mock.now.return_value = MagicMock(
            date=MagicMock(return_value=MagicMock(isoformat=MagicMock(return_value="2026-03-17"))),
            replace=MagicMock(return_value=MagicMock(isoformat=MagicMock(return_value="2026-03-17T14:23:00+00:00"))),
        )
        cost_tracker.log_usage("user1", "agent_plan", 400, 300)

    saved_records = json.loads(container.storage_map["usage/user__user1/2026-03-17.json"])
    assert saved_records[0]["feature"] == "agent_plan"


@patch("app.services.cost_tracker._get_memory_container")
def test_get_daily_usage_returns_records_for_date(get_memory_container_mock):
    container = FakeContainer(
        {"usage/user__user1/2026-03-17.json": json.dumps([{"feature": "chat"}, {"feature": "memory"}, {"feature": "agent_plan"}])}
    )
    get_memory_container_mock.return_value = container

    records = cost_tracker.get_daily_usage("user1", "2026-03-17")
    assert len(records) == 3


@patch("app.services.cost_tracker._get_memory_container")
def test_get_daily_usage_returns_empty_list_when_no_records(get_memory_container_mock):
    container = FakeContainer({})
    get_memory_container_mock.return_value = container

    assert cost_tracker.get_daily_usage("user1", "2026-03-17") == []


def test_get_usage_summary_aggregates_total_cost():
    with patch(
        "app.services.cost_tracker.get_daily_usage",
        side_effect=[
            [{"feature": "chat", "input_tokens": 1, "output_tokens": 1, "cost_usd": 0.10}],
            [{"feature": "chat", "input_tokens": 1, "output_tokens": 1, "cost_usd": 0.20}],
            [{"feature": "chat", "input_tokens": 1, "output_tokens": 1, "cost_usd": 0.15}],
        ],
    ), patch("app.services.cost_tracker.datetime") as datetime_mock:
        datetime_mock.now.return_value = MagicMock(date=MagicMock(return_value=MagicMock(isoformat=MagicMock(return_value="2026-03-17"))))
        summary = cost_tracker.get_usage_summary("user1", days=3)

    assert summary["total_cost_usd"] == 0.45


def test_get_usage_summary_breaks_down_by_feature():
    with patch(
        "app.services.cost_tracker.get_daily_usage",
        side_effect=[
            [
                {"feature": "chat", "input_tokens": 10, "output_tokens": 5, "cost_usd": 0.10},
                {"feature": "memory", "input_tokens": 4, "output_tokens": 2, "cost_usd": 0.05},
            ]
        ],
    ), patch("app.services.cost_tracker.datetime") as datetime_mock:
        datetime_mock.now.return_value = MagicMock(date=MagicMock(return_value=MagicMock(isoformat=MagicMock(return_value="2026-03-17"))))
        summary = cost_tracker.get_usage_summary("user1", days=1)

    assert summary["by_feature"]["chat"]["calls"] == 1
    assert summary["by_feature"]["memory"]["calls"] == 1
    assert summary["by_feature"]["memory"]["cost_usd"] == 0.05


def test_get_usage_summary_returns_daily_costs_list():
    with patch(
        "app.services.cost_tracker.get_daily_usage",
        side_effect=[[{"feature": "chat", "input_tokens": 1, "output_tokens": 1, "cost_usd": 0.01}] for _ in range(5)],
    ), patch("app.services.cost_tracker.datetime") as datetime_mock:
        datetime_mock.now.return_value = MagicMock(date=MagicMock(return_value=MagicMock(isoformat=MagicMock(return_value="2026-03-17"))))
        summary = cost_tracker.get_usage_summary("user1", days=5)

    assert len(summary["daily_costs"]) == 5
    assert all("date" in entry and "cost_usd" in entry for entry in summary["daily_costs"])


def test_get_usage_summary_handles_days_with_no_usage():
    with patch(
        "app.services.cost_tracker.get_daily_usage",
        side_effect=[[], [{"feature": "chat", "input_tokens": 2, "output_tokens": 1, "cost_usd": 0.10}], []],
    ), patch("app.services.cost_tracker.datetime") as datetime_mock:
        datetime_mock.now.return_value = MagicMock(date=MagicMock(return_value=MagicMock(isoformat=MagicMock(return_value="2026-03-17"))))
        summary = cost_tracker.get_usage_summary("user1", days=3)

    assert len(summary["daily_costs"]) == 3
    assert summary["total_cost_usd"] == 0.1


def test_check_daily_limit_returns_correct_percentage():
    with patch(
        "app.services.cost_tracker.get_daily_usage",
        return_value=[{"feature": "chat", "cost_usd": 0.50}],
    ):
        summary = cost_tracker.check_daily_limit("user1", daily_limit_usd=1.00)

    assert summary["percentage_used"] == 50.0
    assert summary["limit_exceeded"] is False


def test_check_daily_limit_detects_exceeded_limit():
    with patch(
        "app.services.cost_tracker.get_daily_usage",
        return_value=[{"feature": "chat", "cost_usd": 1.50}],
    ):
        summary = cost_tracker.check_daily_limit("user1", daily_limit_usd=1.00)

    assert summary["limit_exceeded"] is True
    assert summary["percentage_used"] == 150.0


def test_check_daily_limit_returns_zero_when_no_usage_today():
    with patch("app.services.cost_tracker.get_daily_usage", return_value=[]):
        summary = cost_tracker.check_daily_limit("user1", daily_limit_usd=1.00)

    assert summary["today_cost_usd"] == 0.0
    assert summary["limit_exceeded"] is False


@patch("app.main.get_usage_summary")
def test_usage_summary_endpoint_returns_correct_structure(get_usage_summary_mock):
    app.dependency_overrides[require_user_id] = lambda: "user_123"
    get_usage_summary_mock.return_value = {
        "total_cost_usd": 0.45,
        "total_input_tokens": 150000,
        "total_output_tokens": 45000,
        "by_feature": {"chat": {"cost_usd": 0.30, "calls": 45}},
        "daily_costs": [{"date": "2026-03-17", "cost_usd": 0.02}],
    }

    response = client.get("/api/usage/summary")
    app.dependency_overrides.pop(require_user_id, None)

    assert response.status_code == 200
    payload = response.json()
    assert "total_cost_usd" in payload
    assert "by_feature" in payload
    assert "daily_costs" in payload


@patch("app.main.check_daily_limit")
@patch("app.main.get_daily_usage")
@patch("app.main.load_profile")
def test_usage_today_endpoint_returns_records_and_summary(load_profile_mock, get_daily_usage_mock, check_daily_limit_mock):
    app.dependency_overrides[require_user_id] = lambda: "user_123"
    load_profile_mock.return_value = {"daily_limit_usd": 1.0}
    get_daily_usage_mock.return_value = [{"feature": "chat", "cost_usd": 0.1}]
    check_daily_limit_mock.return_value = {
        "today_cost_usd": 0.1,
        "daily_limit_usd": 1.0,
        "limit_exceeded": False,
        "percentage_used": 10.0,
    }

    response = client.get("/api/usage/today")
    app.dependency_overrides.pop(require_user_id, None)

    assert response.status_code == 200
    assert "records" in response.json()
    assert "summary" in response.json()


@patch("app.main.load_profile")
def test_get_usage_limit_returns_current_limit(load_profile_mock):
    app.dependency_overrides[require_user_id] = lambda: "user_123"
    load_profile_mock.return_value = {"daily_limit_usd": 2.5}

    response = client.get("/api/usage/limit")
    app.dependency_overrides.pop(require_user_id, None)

    assert response.status_code == 200
    assert response.json() == {"daily_limit_usd": 2.5}


@patch("app.main.save_profile")
def test_patch_limit_updates_user_profile(save_profile_mock):
    app.dependency_overrides[require_user_id] = lambda: "user_123"

    response = client.patch("/api/usage/limit", json={"daily_limit_usd": 2.0})
    app.dependency_overrides.pop(require_user_id, None)

    assert response.status_code == 200
    save_profile_mock.assert_called_once()
    assert response.json()["message"] == "Daily limit updated to $2.00"


def test_patch_limit_rejects_negative_value():
    app.dependency_overrides[require_user_id] = lambda: "user_123"
    response = client.patch("/api/usage/limit", json={"daily_limit_usd": -5.0})
    app.dependency_overrides.pop(require_user_id, None)

    assert response.status_code == 400
    assert "greater than zero" in response.json()["detail"]


def test_patch_limit_rejects_zero_value():
    app.dependency_overrides[require_user_id] = lambda: "user_123"
    response = client.patch("/api/usage/limit", json={"daily_limit_usd": 0})
    app.dependency_overrides.pop(require_user_id, None)

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_log_usage_called_after_chat_completes():
    created_tasks: list[asyncio.Task] = []
    log_usage_mock = MagicMock()

    with (
        patch("app.main.save_user_message"),
        patch("app.main.save_assistant_message"),
        patch("app.main.build_memory_prompt", return_value=""),
        patch("app.main.list_user_files", return_value=[]),
        patch("app.main.generate_reply_with_usage", AsyncMock(return_value=("Hello back", {"input_tokens": 500, "output_tokens": 200}))),
        patch("app.main.process_memory_update", AsyncMock(return_value=None)),
        patch("app.main.log_usage", log_usage_mock),
        patch("app.main.asyncio.to_thread", side_effect=run_immediately),
        patch("app.main.asyncio.create_task", side_effect=schedule_and_capture(created_tasks)),
    ):
        response = await post_chat(
            payload={"session_id": "session-1", "message": "hello", "model": "gpt-5", "stream": False, "force_search": False},
            user_id="user_123",
            naming={"display_name": "Abdul Hanan", "session_title": "Hello"},
        )
        if created_tasks:
            await asyncio.gather(*created_tasks)

    assert response.status_code == 200
    log_usage_mock.assert_called_with("user_123", "chat", 500, 200, "Abdul Hanan")


@pytest.mark.asyncio
async def test_log_usage_called_for_title_generation():
    created_tasks: list[asyncio.Task] = []
    log_usage_mock = MagicMock()

    with (
        patch("app.main.generate_conversation_title_with_usage", MagicMock(return_value=("API Debugging", {"input_tokens": 120, "output_tokens": 20}))),
        patch("app.main.log_usage", log_usage_mock),
        patch("app.main.asyncio.to_thread", side_effect=run_immediately),
        patch("app.main.asyncio.create_task", side_effect=schedule_and_capture(created_tasks)),
    ):
        result = await post_conversation_title(
            payload={"prompt": "help me debug", "reply": ""},
            user_id="user_123",
            naming={"display_name": "Abdul Hanan", "session_title": "API Debugging"},
        )
        if created_tasks:
            await asyncio.gather(*created_tasks)

    assert result == {"title": "API Debugging"}
    log_usage_mock.assert_called_with("user_123", "title_generation", 120, 20, "Abdul Hanan")


@pytest.mark.asyncio
async def test_log_usage_called_for_memory_extraction():
    log_usage_mock = MagicMock()

    with (
        patch("app.services.memory.extract_facts_with_usage", return_value=({"name": "Ali"}, {"input_tokens": 100, "output_tokens": 50})),
        patch("app.services.memory.save_profile"),
        patch("app.services.memory.log_usage", log_usage_mock),
        patch("app.services.memory.asyncio.to_thread", side_effect=run_immediately),
    ):
        await memory.process_memory_update("user_123", "message", "reply", "Abdul Hanan")

    log_usage_mock.assert_called_with("user_123", "memory", 100, 50, "Abdul Hanan")


@pytest.mark.asyncio
async def test_log_usage_called_for_agent_plan():
    created_tasks: list[asyncio.Task] = []
    log_usage_mock = MagicMock()

    with (
        patch("app.main.create_task_plan_with_usage", AsyncMock(return_value=({"plan_id": "plan-1", "goal": "Goal", "steps": []}, {"input_tokens": 250, "output_tokens": 120}))),
        patch("app.main.save_task_plan"),
        patch("app.main.log_usage", log_usage_mock),
        patch("app.main.asyncio.to_thread", side_effect=run_immediately),
        patch("app.main.asyncio.create_task", side_effect=schedule_and_capture(created_tasks)),
    ):
        result = await post_agent_plan(
            payload={"goal": "Goal", "session_id": "session-1"},
            user_id="user_123",
            naming={"display_name": "Abdul Hanan", "session_title": "Goal"},
        )
        if created_tasks:
            await asyncio.gather(*created_tasks)

    assert "plan" in result
    log_usage_mock.assert_called_with("user_123", "agent_plan", 250, 120, "Abdul Hanan")


@pytest.mark.asyncio
async def test_log_usage_called_for_agent_step_and_summary():
    created_tasks: list[asyncio.Task] = []
    log_usage_mock = MagicMock()

    async def fake_stream_agent_execution(*_args, **_kwargs):
        yield {
            "type": "step_start",
            "step_number": 1,
            "description": "Think",
        }
        yield {
            "type": "step_done",
            "step_number": 1,
            "result": "Step result",
            "status": "done",
            "error": None,
            "usage": {"input_tokens": 80, "output_tokens": 40},
        }
        yield {
            "type": "final_state",
            "execution_log": [],
            "summary": "Final answer",
            "warning_message": None,
            "summary_usage": {"input_tokens": 60, "output_tokens": 20},
        }

    with (
        patch("app.main.load_task_plan", return_value={"plan_id": "plan-1", "goal": "Goal", "steps": [{"step_number": 1, "description": "Think", "tool": None, "tool_input": None}]}),
        patch("app.main.stream_agent_execution", fake_stream_agent_execution),
        patch("app.main.save_execution_log"),
        patch("app.main.log_usage", log_usage_mock),
        patch("app.main.asyncio.to_thread", side_effect=run_immediately),
        patch("app.main.asyncio.create_task", side_effect=schedule_and_capture(created_tasks)),
    ):
        response = await post_agent_run(
            plan_id="plan-1",
            payload={"session_id": "session-1"},
            user_id="user_123",
            naming={"display_name": "Abdul Hanan", "session_title": "Goal"},
        )
        chunks = []
        async for chunk in response.body_iterator:
            chunks.append(chunk)
        if created_tasks:
            await asyncio.gather(*created_tasks)

    combined = "".join(part if isinstance(part, str) else part.decode("utf-8") for part in chunks)
    assert '"type": "done"' in combined
    assert log_usage_mock.call_args_list[0].args == ("user_123", "agent_step", 80, 40, "Abdul Hanan")
    assert log_usage_mock.call_args_list[1].args == ("user_123", "agent_summary", 60, 20, "Abdul Hanan")
