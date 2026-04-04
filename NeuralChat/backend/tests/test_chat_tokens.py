from unittest.mock import patch

from app.main import _build_token_usage_payload
from app.services.chat_service import save_assistant_message


def test_build_token_usage_payload_uses_default_context_window():
    payload = _build_token_usage_payload("gpt-5", {"input_tokens": 7_944, "output_tokens": 8_209})

    assert payload["input_tokens"] == 7_944
    assert payload["output_tokens"] == 8_209
    assert payload["total_tokens"] == 16_153
    assert payload["context_window_tokens"] == 262_144
    assert payload["context_percentage_used"] == 6.2


def test_build_token_usage_payload_respects_env_override(monkeypatch):
    monkeypatch.setenv("GPT5_CONTEXT_WINDOW_TOKENS", "100000")

    payload = _build_token_usage_payload("gpt-5", {"input_tokens": 25_000, "output_tokens": 5_000})

    assert payload["context_window_tokens"] == 100_000
    assert payload["context_percentage_used"] == 30.0


def test_save_assistant_message_persists_token_fields():
    captured_payload: dict[str, object] = {}

    def fake_append_message(store, user_id, session_id, payload, display_name=None, session_title=None):
        del store, user_id, session_id, display_name, session_title
        captured_payload.update(payload)

    with patch("app.services.chat_service.append_message", side_effect=fake_append_message):
        save_assistant_message(
            session_id="session-1",
            model="gpt-5",
            request_id="request-1",
            reply="Done",
            store={},
            user_id="user-1",
            input_tokens=400,
            output_tokens=200,
            total_tokens=600,
            context_window_tokens=262_144,
            context_percentage_used=0.2,
        )

    assert captured_payload["input_tokens"] == 400
    assert captured_payload["output_tokens"] == 200
    assert captured_payload["total_tokens"] == 600
    assert captured_payload["context_window_tokens"] == 262_144
    assert captured_payload["context_percentage_used"] == 0.2
