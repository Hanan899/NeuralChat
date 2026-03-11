from __future__ import annotations

import os
import unittest

os.environ.setdefault("NEURALCHAT_STORAGE_MODE", "memory")

from app.services.storage import conversation_blob_name


class StorageTests(unittest.TestCase):
    def test_conversation_blob_name_is_user_scoped(self):
        blob_name = conversation_blob_name(user_id="user_123", session_id="session_abc")
        self.assertEqual(blob_name, "conversations/user_123/session_abc.json")

    def test_conversation_blob_name_sanitizes_unsafe_chars(self):
        blob_name = conversation_blob_name(user_id="user@example.com", session_id="a/b")
        self.assertEqual(blob_name, "conversations/user_example_com/a_b.json")


if __name__ == "__main__":
    unittest.main()
