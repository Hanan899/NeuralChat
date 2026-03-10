"""FastAPI surface for NeuralChat backend.

Explain this code:
- `/api/health` proves backend is alive.
- `/api/chat` validates input, stores history, and returns NDJSON token stream.
"""

from __future__ import annotations  # Use postponed evaluation of type hints.

import json  # Encode streamed chunks as JSON lines.
import os  # Read optional CORS origin overrides from environment.
import time  # Measure response time in milliseconds.
import uuid  # Generate unique request IDs.
from datetime import UTC, datetime  # Create timezone-aware timestamps.
from pathlib import Path  # Build filesystem paths safely.
from typing import Any  # Type for dynamic request payload dictionaries.
from typing import AsyncIterator  # Type for async generator return values.

from fastapi import Body  # Read raw JSON request body.
from fastapi import FastAPI  # Main web framework app object.
from fastapi.middleware.cors import CORSMiddleware  # Handle browser CORS preflight requests.
from fastapi.responses import JSONResponse, StreamingResponse  # Return JSON or stream responses.

from app.schemas import build_chat_json_response, build_health_response, validate_chat_request  # Validation + response helpers.
from app.services.chat_service import generate_reply, save_assistant_message, save_user_message, stream_tokens  # Chat orchestration helpers.
from app.services.storage import init_store  # Initialize local message storage path.

APP_VERSION = "0.1.0"  # Backend semantic version string.
BASE_DIR = Path(__file__).resolve().parents[1]  # Root `backend/` directory.
DATA_DIR = BASE_DIR / "data" / "conversations"  # Folder where session JSON files are stored.

STORE_PATH = init_store(DATA_DIR)  # Ensure storage folder exists and keep normalized path.

app = FastAPI(title="NeuralChat Backend", version=APP_VERSION)  # Create FastAPI app instance.

raw_origins = os.getenv("CORS_ALLOW_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")  # Default Vite dev origins.
allowed_origins = [origin.strip() for origin in raw_origins.split(",") if origin.strip()]  # Normalize comma-separated origins.

app.add_middleware(  # Add CORS middleware so browser preflight (OPTIONS) succeeds.
    CORSMiddleware,  # Built-in Starlette/FastAPI CORS support.
    allow_origins=allowed_origins,  # Origins that can call this API from browser.
    allow_credentials=True,  # Allow cookies/auth headers if needed later.
    allow_methods=["*"],  # Permit all HTTP methods including OPTIONS.
    allow_headers=["*"],  # Permit all custom request headers.
)


@app.get("/api/health")  # Register health-check endpoint.
def get_health() -> dict[str, str]:  # Return service status metadata.
    return build_health_response(timestamp=datetime.now(UTC).isoformat(), version=APP_VERSION)  # Build and return health payload.


@app.post("/api/chat")  # Register chat endpoint.
async def post_chat(payload: dict[str, Any] = Body(...)):  # Accept raw request JSON body.
    request = validate_chat_request(payload)  # Validate and normalize incoming request fields.
    request_id = str(uuid.uuid4())  # Create unique ID for tracing this request.
    start = time.perf_counter()  # Start high-resolution timer.

    save_user_message(request=request, request_id=request_id, store_path=STORE_PATH)  # Persist user message to local memory.
    reply = await generate_reply(request=request, store_path=STORE_PATH)  # Generate assistant reply (Claude/GPT/mock).

    if not request["stream"]:  # Handle non-stream mode first.
        response_ms = int((time.perf_counter() - start) * 1000)  # Compute total response time in ms.
        save_assistant_message(  # Persist assistant message for conversation history.
            session_id=request["session_id"],  # Session identifier for file grouping.
            model=request["model"],  # Selected model name.
            request_id=request_id,  # Same request ID for traceability.
            reply=reply,  # Final assistant text.
            store_path=STORE_PATH,  # Base folder for local storage.
        )
        response_payload = build_chat_json_response(  # Build standard JSON response body.
            request_id=request_id,  # Include unique request ID.
            reply=reply,  # Include assistant reply text.
            model=request["model"],  # Include model used.
            response_ms=response_ms,  # Include duration in milliseconds.
        )
        return JSONResponse(response_payload)  # Return non-stream JSON response.

    async def stream() -> AsyncIterator[str]:  # Internal async generator for NDJSON streaming.
        assembled: list[str] = []  # Collect streamed tokens to build final reply text.

        async for token in stream_tokens(reply):  # Yield tokens one-by-one with optional delay.
            assembled.append(token)  # Keep token for final persistence.
            yield json.dumps({"type": "token", "content": token}, ensure_ascii=True) + "\n"  # Emit NDJSON token line.

        final_reply = "".join(assembled).strip()  # Build final full reply from token list.
        response_ms = int((time.perf_counter() - start) * 1000)  # Compute elapsed time for streamed response.

        save_assistant_message(  # Persist final assistant output after stream completes.
            session_id=request["session_id"],  # Session identifier.
            model=request["model"],  # Model used for generation.
            request_id=request_id,  # Request ID for correlation.
            reply=final_reply,  # Final assembled assistant text.
            store_path=STORE_PATH,  # Local store path.
        )

        yield (  # Emit final completion chunk.
            json.dumps(  # Serialize completion metadata as JSON.
                {
                    "type": "done",  # Marks stream completion.
                    "content": "",  # No extra text in done chunk.
                    "request_id": request_id,  # Echo request ID for frontend debug panel.
                    "response_ms": response_ms,  # Send total duration in ms.
                },
                ensure_ascii=True,  # Keep output ASCII-safe.
            )
            + "\n"  # NDJSON requires newline after each JSON object.
        )

    return StreamingResponse(  # Return streaming response wrapper.
        stream(),  # Async generator source.
        media_type="application/x-ndjson",  # Content type for newline-delimited JSON chunks.
        headers={"x-request-id": request_id},  # Send request ID in header for quick tracing.
    )
