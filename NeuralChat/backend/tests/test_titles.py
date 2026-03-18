import os
from unittest.mock import patch

from fastapi.testclient import TestClient

os.environ.setdefault("NEURALCHAT_STORAGE_MODE", "memory")

from app.auth import require_user_id
from app.main import app
from app.services.titles import fallback_conversation_title, sanitize_conversation_title


client = TestClient(app)


def test_fallback_conversation_title_prefers_compact_summary():
    title = fallback_conversation_title("Can you tell me what is inside this attached product requirements document?")
    assert title == "Document Review"


def test_sanitize_conversation_title_limits_length():
    title = sanitize_conversation_title("A very long generated title with too many words for one sidebar row", "help me debug latency")
    assert len(title.split()) <= 6


def test_post_conversation_title_returns_generated_title():
    app.dependency_overrides[require_user_id] = lambda: "user_123"
    with patch("app.main.generate_conversation_title_with_usage", return_value=("API Latency Debugging", {"input_tokens": 0, "output_tokens": 0})):
        response = client.post("/api/conversations/title", json={"prompt": "help me debug my API latency", "reply": ""})
    app.dependency_overrides.pop(require_user_id, None)

    assert response.status_code == 200
    assert response.json() == {"title": "API Latency Debugging"}
