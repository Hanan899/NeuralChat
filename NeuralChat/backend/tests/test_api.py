from __future__ import annotations

import json
import uuid
import unittest

from fastapi.testclient import TestClient

from app.main import app


class APITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_health_returns_expected_shape(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "ok")
        self.assertIn("timestamp", payload)
        self.assertIn("version", payload)

    def test_chat_rejects_invalid_model(self):
        response = self.client.post(
            "/api/chat",
            json={
                "session_id": "s-1",
                "message": "hello",
                "model": "invalid-model",
                "stream": False,
            },
        )
        self.assertEqual(response.status_code, 422)

    def test_chat_stream_emits_token_then_done(self):
        response = self.client.post(
            "/api/chat",
            json={
                "session_id": f"s-{uuid.uuid4()}",
                "message": "test stream",
                "model": "claude",
                "stream": True,
            },
        )
        self.assertEqual(response.status_code, 200)

        chunks = [json.loads(line) for line in response.text.splitlines() if line.strip()]
        self.assertGreaterEqual(len(chunks), 2)
        self.assertEqual(chunks[0]["type"], "token")
        self.assertEqual(chunks[-1]["type"], "done")


if __name__ == "__main__":
    unittest.main()
