"""FastAPI surface for NeuralChat backend.

Explain this code:
- `/api/health` proves backend is alive.
- `/api/chat` validates input, enforces auth, and returns NDJSON token stream.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from typing import AsyncIterator

from fastapi import Body, Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from app.auth import require_user_id
from app.env_loader import load_local_settings_env
from app.schemas import build_chat_json_response, build_health_response, validate_chat_request
from app.services.chat_service import generate_reply, save_assistant_message, save_user_message, stream_tokens, tokenize_text
from app.services.storage import init_store, load_profile, touch_profile

APP_VERSION = "0.2.0"
BASE_DIR = Path(__file__).resolve().parents[1]

load_local_settings_env(BASE_DIR)
STORE = init_store()

app = FastAPI(title="NeuralChat Backend", version=APP_VERSION)

raw_origins = os.getenv("CORS_ALLOW_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
allowed_origins = [origin.strip() for origin in raw_origins.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def get_health() -> dict[str, str]:
    return build_health_response(timestamp=datetime.now(UTC).isoformat(), version=APP_VERSION)


@app.get("/api/me")
def get_me(user_id: str = Depends(require_user_id)) -> dict[str, Any]:
    touch_profile(STORE, user_id)
    profile = load_profile(STORE, user_id)
    return {
        "status": "ok",
        "user_id": user_id,
        "profile": profile,
    }


@app.post("/api/chat")
async def post_chat(
    payload: dict[str, Any] = Body(...),
    user_id: str = Depends(require_user_id),
):
    request = validate_chat_request(payload)
    request_id = str(uuid.uuid4())
    start = time.perf_counter()

    # Ensure a minimal user profile marker exists for this authenticated user.
    touch_profile(STORE, user_id)

    save_user_message(request=request, request_id=request_id, store=STORE, user_id=user_id)
    reply = await generate_reply(request=request, store=STORE, user_id=user_id)

    if not request["stream"]:
        response_ms = int((time.perf_counter() - start) * 1000)
        tokens_emitted = len(tokenize_text(reply))
        save_assistant_message(
            session_id=request["session_id"],
            model=request["model"],
            request_id=request_id,
            reply=reply,
            store=STORE,
            user_id=user_id,
            status="completed",
            response_ms=response_ms,
            first_token_ms=response_ms,
            tokens_emitted=tokens_emitted,
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
        tokens_emitted = 0
        first_token_ms: int | None = None
        stream_status = "interrupted"

        try:
            async for token in stream_tokens(reply):
                if first_token_ms is None:
                    first_token_ms = int((time.perf_counter() - start) * 1000)
                tokens_emitted += 1
                assembled.append(token)
                yield json.dumps({"type": "token", "content": token}, ensure_ascii=True) + "\n"

            response_ms = int((time.perf_counter() - start) * 1000)
            stream_status = "completed"
            resolved_first_token_ms = first_token_ms if first_token_ms is not None else response_ms

            yield (
                json.dumps(
                    {
                        "type": "done",
                        "content": "",
                        "request_id": request_id,
                        "response_ms": response_ms,
                        "first_token_ms": resolved_first_token_ms,
                        "tokens_emitted": tokens_emitted,
                        "status": stream_status,
                    },
                    ensure_ascii=True,
                )
                + "\n"
            )
        except asyncio.CancelledError:
            stream_status = "interrupted"
            raise
        except Exception as stream_error:
            stream_status = "interrupted"
            yield (
                json.dumps(
                    {
                        "type": "error",
                        "content": f"Streaming interrupted: {stream_error}",
                        "request_id": request_id,
                    },
                    ensure_ascii=True,
                )
                + "\n"
            )
        finally:
            final_reply = "".join(assembled).strip()
            response_ms_final = int((time.perf_counter() - start) * 1000)
            resolved_first_token_ms = first_token_ms if first_token_ms is not None else response_ms_final

            if stream_status == "completed" or final_reply:
                save_assistant_message(
                    session_id=request["session_id"],
                    model=request["model"],
                    request_id=request_id,
                    reply=final_reply,
                    store=STORE,
                    user_id=user_id,
                    status=stream_status,
                    response_ms=response_ms_final,
                    first_token_ms=resolved_first_token_ms,
                    tokens_emitted=tokens_emitted,
                )

    return StreamingResponse(
        stream(),
        media_type="application/x-ndjson",
        headers={"x-request-id": request_id},
    )
