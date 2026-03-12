from __future__ import annotations

from app.services.storage import conversation_blob_name


def test_conversation_blob_name_is_user_scoped():
    blob_name = conversation_blob_name(user_id="user_123", session_id="session_abc")
    assert blob_name == "conversations/user_123/session_abc.json"


def test_conversation_blob_name_sanitizes_unsafe_chars():
    blob_name = conversation_blob_name(user_id="user@example.com", session_id="a/b")
    assert blob_name == "conversations/user_example_com/a_b.json"
