"""FastAPI surface for NeuralChat backend.

Explain this code:
- `/api/health` proves backend is alive.
- `/api/chat` validates input, stores history, and returns NDJSON token stream.
"""

from __future__ import annotations  # Use postponed evaluation of type hints.

import asyncio  # Detect client disconnect cancellation during streaming.
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
from app.services.chat_service import generate_reply, save_assistant_message, save_user_message, stream_tokens, tokenize_text  # Chat orchestration helpers.
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
        tokens_emitted = len(tokenize_text(reply))  # Estimate output token-chunks for debug/metrics.
        save_assistant_message(  # Persist assistant message for conversation history.
            session_id=request["session_id"],  # Session identifier for file grouping.
            model=request["model"],  # Selected model name.
            request_id=request_id,  # Same request ID for traceability.
            reply=reply,  # Final assistant text.
            store_path=STORE_PATH,  # Base folder for local storage.
            status="completed",  # Non-stream path reached normal completion.
            response_ms=response_ms,  # Save duration metadata for analysis.
            first_token_ms=response_ms,  # In non-stream mode first token appears with final payload.
            tokens_emitted=tokens_emitted,  # Save count of emitted chunks.
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
        tokens_emitted = 0  # Track how many token chunks were actually sent to client.
        first_token_ms: int | None = None  # Capture first-token latency once first chunk leaves server.
        stream_status = "interrupted"  # Default to interrupted; switch to completed only after done chunk.

        try:  # Try streaming all tokens and a done event.
            async for token in stream_tokens(reply):  # Yield tokens one-by-one with optional delay.
                if first_token_ms is None:  # First token boundary for latency measurement.
                    first_token_ms = int((time.perf_counter() - start) * 1000)  # Compute time-to-first-token.
                tokens_emitted += 1  # Increment emitted token counter.
                assembled.append(token)  # Keep token for final persistence.
                yield json.dumps({"type": "token", "content": token}, ensure_ascii=True) + "\n"  # Emit NDJSON token line.

            response_ms = int((time.perf_counter() - start) * 1000)  # Compute elapsed time for streamed response.
            stream_status = "completed"  # Mark successful completion before done chunk.
            resolved_first_token_ms = first_token_ms if first_token_ms is not None else response_ms  # Fallback for empty replies.

            yield (  # Emit final completion chunk.
                json.dumps(  # Serialize completion metadata as JSON.
                    {
                        "type": "done",  # Marks stream completion.
                        "content": "",  # No extra text in done chunk.
                        "request_id": request_id,  # Echo request ID for frontend debug panel.
                        "response_ms": response_ms,  # Send total duration in ms.
                        "first_token_ms": resolved_first_token_ms,  # Expose first-token latency metric.
                        "tokens_emitted": tokens_emitted,  # Expose stream throughput metric.
                        "status": stream_status,  # Explicit completion status for frontend logic.
                    },
                    ensure_ascii=True,  # Keep output ASCII-safe.
                )
                + "\n"  # NDJSON requires newline after each JSON object.
            )
        except asyncio.CancelledError:  # Browser closed connection while stream was in progress.
            stream_status = "interrupted"  # Persist interruption state in conversation history.
            raise  # Re-raise cancellation so server can stop sending.
        except Exception as stream_error:  # Handle unexpected streaming errors.
            stream_status = "interrupted"  # Any exception means completion did not happen.
            yield (  # Attempt to inform frontend that stream failed.
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
        finally:  # Always persist whatever was generated so far.
            final_reply = "".join(assembled).strip()  # Build final/partial reply from emitted token list.
            response_ms_final = int((time.perf_counter() - start) * 1000)  # Final elapsed time snapshot.
            resolved_first_token_ms = first_token_ms if first_token_ms is not None else response_ms_final  # Keep metric populated.

            if stream_status == "completed" or final_reply:  # Save completed replies and meaningful partial replies.
                save_assistant_message(  # Persist final assistant output even if stream was interrupted.
                    session_id=request["session_id"],  # Session identifier.
                    model=request["model"],  # Model used for generation.
                    request_id=request_id,  # Request ID for correlation.
                    reply=final_reply,  # Final assembled assistant text (possibly partial).
                    store_path=STORE_PATH,  # Local store path.
                    status=stream_status,  # completed or interrupted for recovery logic.
                    response_ms=response_ms_final,  # Persist total elapsed time.
                    first_token_ms=resolved_first_token_ms,  # Persist first-token latency.
                    tokens_emitted=tokens_emitted,  # Persist actual emitted token count.
                )

    return StreamingResponse(  # Return streaming response wrapper.
        stream(),  # Async generator source.
        media_type="application/x-ndjson",  # Content type for newline-delimited JSON chunks.
        headers={"x-request-id": request_id},  # Send request ID in header for quick tracing.
    )
