"""FastAPI surface for NeuralChat backend.

Explain this code:
- `/api/health` proves backend is alive.
- `/api/chat` validates input, stores history, and returns NDJSON token stream.
"""

from __future__ import annotations

import json
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from typing import AsyncIterator

from fastapi import Body
from fastapi import FastAPI
from fastapi.responses import JSONResponse, StreamingResponse

from app.schemas import build_chat_json_response, build_health_response, validate_chat_request
from app.services.chat_service import generate_reply, save_assistant_message, save_user_message, stream_tokens
from app.services.storage import init_store

APP_VERSION = "0.1.0"
BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data" / "conversations"

STORE_PATH = init_store(DATA_DIR)

app = FastAPI(title="NeuralChat Backend", version=APP_VERSION)


@app.get("/api/health")
def get_health() -> dict[str, str]:
    return build_health_response(timestamp=datetime.now(UTC).isoformat(), version=APP_VERSION)


@app.post("/api/chat")
async def post_chat(payload: dict[str, Any] = Body(...)):
    request = validate_chat_request(payload)
    request_id = str(uuid.uuid4())
    start = time.perf_counter()

    save_user_message(request=request, request_id=request_id, store_path=STORE_PATH)
    reply = await generate_reply(request=request, store_path=STORE_PATH)

    if not request["stream"]:
        response_ms = int((time.perf_counter() - start) * 1000)
        save_assistant_message(
            session_id=request["session_id"],
            model=request["model"],
            request_id=request_id,
            reply=reply,
            store_path=STORE_PATH,
        )
        response_payload = build_chat_json_response(
            request_id=request_id,
            reply=reply,
            model=request["model"],
            response_ms=response_ms,
        )
        return JSONResponse(response_payload)

    async def stream() -> AsyncIterator[str]:
        assembled: list[str] = []

        async for token in stream_tokens(reply):
            assembled.append(token)
            yield json.dumps({"type": "token", "content": token}, ensure_ascii=True) + "\n"

        final_reply = "".join(assembled).strip()
        response_ms = int((time.perf_counter() - start) * 1000)

        save_assistant_message(
            session_id=request["session_id"],
            model=request["model"],
            request_id=request_id,
            reply=final_reply,
            store_path=STORE_PATH,
        )

        yield (
            json.dumps(
                {
                    "type": "done",
                    "content": "",
                    "request_id": request_id,
                    "response_ms": response_ms,
                },
                ensure_ascii=True,
            )
            + "\n"
        )

    return StreamingResponse(
        stream(),
        media_type="application/x-ndjson",
        headers={"x-request-id": request_id},
    )
