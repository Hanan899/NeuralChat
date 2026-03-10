# NeuralChat Architecture (Beginner Version)

## 1) Big Picture
NeuralChat has two parts:
- `frontend` (React + Tailwind): what you see in the browser.
- `backend` (Azure Functions + FastAPI in Python): APIs, model calls, and memory.

Request flow:
1. You type a message in React.
2. Frontend calls `POST /api/chat`.
3. Backend stores your user message in local JSON memory.
4. Backend picks Claude or GPT-4o.
5. Backend returns NDJSON token chunks.
6. Frontend appends tokens live to the assistant bubble.
7. Backend stores final assistant reply.

## 2) API Contracts
- `GET /api/health`
  - Returns: `{ status: "ok", timestamp, version }`

- `POST /api/chat`
  - Input: `{ session_id, message, model, stream }`
  - Stream output lines (NDJSON):
    - `{"type":"token","content":"..."}`
    - `{"type":"done","content":"","request_id":"...","response_ms":123}`

## 3) Local Memory Design
- Path: `backend/data/conversations/<session_id>.json`
- Format: array of messages with role/content/model/request_id/created_at.
- Why this design: easy to inspect manually before moving to Azure Blob.

## 4) Model Routing
- `model = "claude"` -> calls Anthropic API if `CLAUDE_API_KEY` is set.
- `model = "gpt4o"` -> calls OpenAI API if `OPENAI_API_KEY` is set.
- If key is missing, backend returns a mock response so development can continue.

## 5) Next Azure Upgrade Path
- Replace local JSON store with Azure Blob container `neurarchat-memory`.
- Keep the same chat service interface so frontend remains unchanged.
