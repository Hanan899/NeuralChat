import asyncio
import json
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from azure.core.exceptions import ResourceNotFoundError

os.environ.setdefault("NEURALCHAT_STORAGE_MODE", "memory")

from app.auth import require_user_id
from app.main import app
from app.services import agent


class FakeBlobClient:
    def __init__(self, storage: dict[str, str], name: str):
        self.storage = storage
        self.name = name
        self.uploads: list[tuple[str, bool, str]] = []
        self.deletes = 0

    def upload_blob(self, data, overwrite=False, content_type=None):
        if isinstance(data, bytes):
            decoded = data.decode("utf-8")
        else:
            decoded = data
        self.storage[self.name] = decoded
        self.uploads.append((decoded, overwrite, content_type))

    def download_blob(self):
        if self.name not in self.storage:
            raise ResourceNotFoundError("missing")

        class Reader:
            def __init__(self, value: str):
                self.value = value

            def readall(self):
                return self.value.encode("utf-8")

        return Reader(self.storage[self.name])

    def delete_blob(self, delete_snapshots=None):
        self.deletes += 1
        if self.name not in self.storage:
            raise ResourceNotFoundError("missing")
        del self.storage[self.name]


class FakeContainer:
    def __init__(self, storage: dict[str, str]):
        self.storage = storage
        self.blobs: dict[str, FakeBlobClient] = {}

    def get_blob_client(self, blob: str):
        if blob not in self.blobs:
            self.blobs[blob] = FakeBlobClient(self.storage, blob)
        return self.blobs[blob]

    def list_blobs(self, name_starts_with: str = ""):
        for name in self.storage:
            if name.startswith(name_starts_with):
                yield type("BlobItem", (), {"name": name})()


# This test checks that planning returns the required keys because the frontend depends on that structure.
@pytest.mark.asyncio
async def test_create_task_plan_returns_valid_plan_structure():
    response = MagicMock()
    response.content = '{"plan_id":"abc123","goal":"Research AI","steps":[{"step_number":1,"description":"Search topic","tool":"web_search","tool_input":"AI"}]}'
    model = MagicMock()
    model.ainvoke = AsyncMock(return_value=response)

    with patch("app.services.agent._get_agent_model", return_value=model):
        plan = await agent.create_task_plan("Research AI", agent.AVAILABLE_AGENT_TOOLS)

    assert plan["plan_id"] == "abc123"
    assert plan["goal"] == "Research AI"
    assert isinstance(plan["steps"], list)
    assert plan["steps"][0]["step_number"] == 1
    assert plan["steps"][0]["tool"] == "web_search"


# This test checks malformed planner output because the backend must fail safely instead of crashing.
@pytest.mark.asyncio
async def test_create_task_plan_returns_empty_steps_on_malformed_gpt_response():
    response = MagicMock()
    response.content = "Sure here is your plan"
    model = MagicMock()
    model.ainvoke = AsyncMock(return_value=response)

    with patch("app.services.agent._get_agent_model", return_value=model):
        plan = await agent.create_task_plan("Research AI", agent.AVAILABLE_AGENT_TOOLS)

    assert plan["goal"] == "Research AI"
    assert plan["steps"] == []


# This test checks the hard 6-step safety cap because plan size must stay bounded.
@pytest.mark.asyncio
async def test_create_task_plan_truncates_to_6_steps_max():
    steps = [
        {"step_number": index, "description": f"Step {index}", "tool": None, "tool_input": None}
        for index in range(1, 11)
    ]
    response = MagicMock()
    response.content = json.dumps({"plan_id": "abc123", "goal": "Research AI", "steps": steps})
    model = MagicMock()
    model.ainvoke = AsyncMock(return_value=response)

    with patch("app.services.agent._get_agent_model", return_value=model):
        plan = await agent.create_task_plan("Research AI", agent.AVAILABLE_AGENT_TOOLS)

    assert len(plan["steps"]) == 6


# This test checks web_search routing because tool steps must call the correct backend integration.
@pytest.mark.asyncio
async def test_execute_step_routes_to_web_search():
    step = {"tool": "web_search", "tool_input": "Python AI libraries", "step_number": 1, "description": "Search"}
    with patch("app.services.agent.search_web", return_value=[{"title": "X", "url": "Y", "snippet": "Z"}]):
        result = await agent.execute_step(step, "user1", "sess1")

    assert result["status"] == "done"
    assert "X" in result["result"]


# This test checks file-read routing because agent mode must reuse parsed session files.
@pytest.mark.asyncio
async def test_execute_step_routes_to_file_read():
    step = {"tool": "read_file", "tool_input": "report.pdf", "step_number": 2, "description": "Read"}
    with patch("app.services.agent._read_session_file_context", return_value="chunk1\n\nchunk2"):
        result = await agent.execute_step(step, "user1", "sess1")

    assert result["status"] == "done"
    assert "chunk1" in result["result"]


# This test checks memory routing because stored profile facts should be available as an agent tool.
@pytest.mark.asyncio
async def test_execute_step_routes_to_memory_recall():
    step = {"tool": "memory_recall", "tool_input": "", "step_number": 3, "description": "Recall"}
    with patch("app.services.agent.load_profile", return_value={"name": "Ali", "job": "Engineer"}):
        result = await agent.execute_step(step, "user1", "sess1")

    assert result["status"] == "done"
    assert "Ali" in result["result"]


# This test checks null-tool reasoning because the agent needs a no-tool reasoning path.
@pytest.mark.asyncio
async def test_execute_step_handles_null_tool_as_reasoning_step():
    step = {"tool": None, "tool_input": None, "description": "Summarize findings", "step_number": 4}
    with patch("app.services.agent._run_reasoning_step", AsyncMock(return_value="Here is the summary...")):
        result = await agent.execute_step(step, "user1", "sess1", goal="Research AI")

    assert result["status"] == "done"
    assert result["result"] == "Here is the summary..."


# This test checks tool failure handling because one broken step must not crash the whole agent run.
@pytest.mark.asyncio
async def test_execute_step_returns_failed_status_on_tool_error():
    step = {"tool": "web_search", "tool_input": "query", "step_number": 1, "description": "Search"}
    with patch("app.services.agent.search_web", side_effect=Exception("Tavily down")):
        result = await agent.execute_step(step, "user1", "sess1")

    assert result["status"] == "failed"
    assert result["error"]


# This test checks that normal varied tool calls are not mistaken for a loop.
def test_check_for_loop_returns_false_when_no_loop():
    log = [
        {"tool": "web_search", "tool_input": "q1"},
        {"tool": "web_search", "tool_input": "q2"},
        {"tool": "web_search", "tool_input": "q3"},
    ]
    assert agent.check_for_loop(log) is False


# This test checks the repeated-call guard because the agent must stop if it spins on the same tool input.
def test_check_for_loop_returns_true_when_same_tool_called_3_times():
    log = [
        {"tool": "web_search", "tool_input": "same query"},
        {"tool": "web_search", "tool_input": "same query"},
        {"tool": "web_search", "tool_input": "same query"},
    ]
    assert agent.check_for_loop(log) is True


# This test checks short logs because one or two calls are not enough evidence of a loop.
def test_check_for_loop_returns_false_with_short_log():
    log = [{"tool": "web_search", "tool_input": "same query"}]
    assert agent.check_for_loop(log) is False


# This test checks plan save path because history and reruns depend on deterministic blob naming.
def test_save_task_plan_saves_to_correct_blob_path():
    container = FakeContainer({})
    plan = {"plan_id": "abc123", "goal": "Research AI", "steps": []}

    with patch("app.services.agent._get_agents_container", return_value=container):
        agent.save_task_plan("user1", plan)

    assert "user1/plans/abc123.json" in container.storage


# This test checks plan loading because the history detail endpoint depends on blob retrieval.
def test_load_task_plan_returns_plan_when_exists():
    container = FakeContainer({"user1/plans/abc123.json": json.dumps({"plan_id": "abc123", "goal": "Research AI", "steps": []})})
    with patch("app.services.agent._get_agents_container", return_value=container):
        result = agent.load_task_plan("user1", "abc123")

    assert result == {"plan_id": "abc123", "goal": "Research AI", "steps": []}


# This test checks missing plans because the backend must return None rather than crash on absent blobs.
def test_load_task_plan_returns_none_when_missing():
    container = FakeContainer({})
    with patch("app.services.agent._get_agents_container", return_value=container):
        result = agent.load_task_plan("user1", "abc123")

    assert result is None


# This test checks execution log storage because the agent history view needs the full step record.
def test_save_execution_log_saves_all_steps():
    container = FakeContainer({})
    log = [{"step_number": 1, "status": "done"}, {"step_number": 2, "status": "failed"}]

    with patch("app.services.agent._get_agents_container", return_value=container):
        agent.save_execution_log("user1", "abc123", log)

    assert "user1/logs/abc123.json" in container.storage


# This test checks summary generation because the user-facing final answer is required output.
@pytest.mark.asyncio
async def test_build_final_summary_returns_string():
    response = MagicMock()
    response.content = "Here is your final answer..."
    model = MagicMock()
    model.ainvoke = AsyncMock(return_value=response)

    with patch("app.services.agent._get_agent_model", return_value=model):
        result = await agent.build_final_summary("Research AI", [{"step_number": 1, "result": "done"}])

    assert isinstance(result, str)
    assert result


# This test checks prompt composition because the goal text must reach the summarizer model call.
@pytest.mark.asyncio
async def test_build_final_summary_includes_goal_in_prompt():
    response = MagicMock()
    response.content = "Here is your final answer..."
    model = MagicMock()
    model.ainvoke = AsyncMock(return_value=response)

    with patch("app.services.agent._get_agent_model", return_value=model):
        await agent.build_final_summary("Research AI", [{"step_number": 1, "result": "done"}])

    called_messages = model.ainvoke.await_args.args[0]
    assert "Research AI" in called_messages[1].content


@pytest.fixture
def client():
    app.dependency_overrides[require_user_id] = lambda: "user_123"
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


# This test checks stream ordering because the frontend expects the plan chunk before progress events.
def test_agent_run_streams_plan_chunk_first(client):
    plan = {"plan_id": "plan-1", "goal": "Research AI", "steps": [{"step_number": 1, "description": "Search", "tool": "web_search", "tool_input": "AI"}]}

    async def fake_stream(_plan, _user_id, _session_id):
        yield {"type": "step_start", "step_number": 1, "description": "Search"}
        yield {"type": "step_done", "step_number": 1, "result": "done", "status": "done", "error": None}
        yield {"type": "final_state", "plan": plan, "execution_log": [{"step_number": 1, "result": "done", "status": "done"}], "warning_message": None, "summary": "Finished"}

    with patch("app.main.load_task_plan", return_value=plan), patch("app.main.stream_agent_execution", fake_stream), patch("app.main.save_execution_log"):
        response = client.post("/api/agent/run/plan-1", json={"session_id": "session-1"})

    chunks = [json.loads(line) for line in response.text.strip().splitlines()]
    assert chunks[0]["type"] == "plan"


# This test checks per-step progress because the frontend renders both start and done states.
def test_agent_run_streams_step_start_and_done_for_each_step(client):
    plan = {
        "plan_id": "plan-1",
        "goal": "Research AI",
        "steps": [
            {"step_number": 1, "description": "Search", "tool": "web_search", "tool_input": "AI"},
            {"step_number": 2, "description": "Summarize", "tool": None, "tool_input": None},
        ],
    }

    async def fake_stream(_plan, _user_id, _session_id):
        yield {"type": "step_start", "step_number": 1, "description": "Search"}
        yield {"type": "step_done", "step_number": 1, "result": "done 1", "status": "done", "error": None}
        yield {"type": "step_start", "step_number": 2, "description": "Summarize"}
        yield {"type": "step_done", "step_number": 2, "result": "done 2", "status": "done", "error": None}
        yield {"type": "final_state", "plan": plan, "execution_log": [], "warning_message": None, "summary": "Finished"}

    with patch("app.main.load_task_plan", return_value=plan), patch("app.main.stream_agent_execution", fake_stream), patch("app.main.save_execution_log"):
        response = client.post("/api/agent/run/plan-1", json={"session_id": "session-1"})

    chunk_types = [json.loads(line)["type"] for line in response.text.strip().splitlines()]
    assert chunk_types.count("step_start") == 2
    assert chunk_types.count("step_done") == 2


# This test checks loop handling because repeated tool calls should stop the run safely.
def test_agent_run_stops_on_loop_detection(client):
    plan = {"plan_id": "plan-1", "goal": "Research AI", "steps": [{"step_number": 1, "description": "Search", "tool": "web_search", "tool_input": "AI"}]}

    async def fake_stream(_plan, _user_id, _session_id):
        yield {"type": "warning", "message": "Agent stopped: repeated tool calls detected."}
        yield {"type": "final_state", "plan": plan, "execution_log": [], "warning_message": "Agent stopped: repeated tool calls detected.", "summary": "Stopped"}

    with patch("app.main.load_task_plan", return_value=plan), patch("app.main.stream_agent_execution", fake_stream), patch("app.main.save_execution_log"):
        response = client.post("/api/agent/run/plan-1", json={"session_id": "session-1"})

    assert "Agent stopped: repeated tool calls detected." in response.text


# This test checks resilience because a failed step must not abort the remaining steps.
def test_agent_run_continues_after_failed_step(client):
    plan = {
        "plan_id": "plan-1",
        "goal": "Research AI",
        "steps": [
            {"step_number": 1, "description": "Search", "tool": "web_search", "tool_input": "AI"},
            {"step_number": 2, "description": "Summarize", "tool": None, "tool_input": None},
        ],
    }

    async def fake_stream(_plan, _user_id, _session_id):
        yield {"type": "step_start", "step_number": 1, "description": "Search"}
        yield {"type": "step_done", "step_number": 1, "result": "", "status": "failed", "error": "Tavily down"}
        yield {"type": "step_start", "step_number": 2, "description": "Summarize"}
        yield {"type": "step_done", "step_number": 2, "result": "done 2", "status": "done", "error": None}
        yield {"type": "final_state", "plan": plan, "execution_log": [], "warning_message": None, "summary": "Finished"}

    with patch("app.main.load_task_plan", return_value=plan), patch("app.main.stream_agent_execution", fake_stream), patch("app.main.save_execution_log"):
        response = client.post("/api/agent/run/plan-1", json={"session_id": "session-1"})

    assert '"status": "failed"' in response.text
    assert '"step_number": 2' in response.text


# This test checks history listing because the panel needs compact task summaries for all saved plans.
def test_agent_history_returns_list_of_past_tasks(client):
    with patch("app.main.list_task_plans", return_value=[
        {"plan_id": "1", "goal": "Goal 1", "created_at": "2026-03-12T00:00:00Z", "steps_count": 2},
        {"plan_id": "2", "goal": "Goal 2", "created_at": "2026-03-12T00:00:00Z", "steps_count": 3},
        {"plan_id": "3", "goal": "Goal 3", "created_at": "2026-03-12T00:00:00Z", "steps_count": 1},
    ]):
        response = client.get("/api/agent/history")

    assert response.status_code == 200
    assert len(response.json()["tasks"]) == 3


# This test checks history detail because the expanded task view needs both the plan and the execution log.
def test_agent_history_detail_returns_plan_and_log(client):
    with patch("app.main.load_task_plan", return_value={"plan_id": "abc123", "goal": "Research AI", "steps": []}), patch(
        "app.main.load_execution_log", return_value=[{"step_number": 1, "tool": "web_search", "result": "done", "status": "done"}]
    ):
        response = client.get("/api/agent/history/abc123")

    assert response.status_code == 200
    assert "plan" in response.json()
    assert "log" in response.json()
