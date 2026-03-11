# NeuralChat Architecture (Auth + Blob Phase)

## 1) Big Picture

NeuralChat has two runtime parts:

- `frontend/` (React + Tailwind + Clerk): chat UI and login/logout shell.
- `backend/` (FastAPI mounted in Azure Functions): auth verification, model routing, streaming, persistence.

## 2) End-to-End Request Flow

1. User lands signed out and sees Clerk `SignIn`.
2. Clerk validates email/password and creates a session.
3. Frontend requests session token from Clerk.
4. Frontend calls protected backend APIs with `Authorization: Bearer <token>`.
5. Backend verifies token via Clerk JWKS and extracts `user_id` from `sub`.
6. Backend stores user message in Azure Blob under `user_id/session_id`.
7. Backend generates model reply (Claude or GPT-4o path).
8. Backend streams NDJSON token chunks to frontend.
9. Frontend renders assistant message incrementally.
10. Backend saves final assistant message and stream metadata.

## 3) API Contracts

- `GET /api/health` (public)
  - Returns: `{ "status": "ok", "timestamp": "...", "version": "..." }`

- `GET /api/me` (auth required)
  - Header: `Authorization: Bearer <clerk_jwt>`
  - Returns: `{ "user_id": "...", "status": "ok" }`

- `POST /api/chat` (auth required)
  - Header: `Authorization: Bearer <clerk_jwt>`
  - Input: `{ "session_id", "message", "model", "stream" }`
  - Stream output lines (NDJSON):
    - `{"type":"token","content":"..."}`
    - `{"type":"done","content":"","request_id":"...","response_ms":123,"first_token_ms":45,"tokens_emitted":55,"status":"completed"}`
    - `{"type":"error","content":"...","request_id":"..."}`

## 4) Storage Design (Azure Blob)

Containers:

- `neurarchat-memory` for conversations
- `neurarchat-profiles` for minimal user profile metadata

Blob key layout:

- `conversations/{user_id}/{session_id}.json`
- `profiles/{user_id}.json`

Notes:

- Client never sends `user_id` in request body.
- `user_id` is derived only from verified JWT claims.
- Existing local JSON history is intentionally not migrated.

## 5) Model Routing

- `model = "claude"`:
  - Uses Anthropic API if `CLAUDE_API_KEY` exists.
- `model = "gpt4o"`:
  - Uses Azure OpenAI if `AZURE_OPENAI_*` config exists.
  - Falls back to OpenAI if `OPENAI_API_KEY` exists and Azure config is absent.
- Missing provider credentials:
  - Returns mock response so local UI and streaming flow remain testable.
