# NeuralChat

[![Status](https://img.shields.io/badge/status-active%20development-0a7ea4)](#project-status)
[![Frontend](https://img.shields.io/badge/frontend-React%20%2B%20Tailwind-38bdf8)](#architecture)
[![Backend](https://img.shields.io/badge/backend-FastAPI%20on%20Azure%20Functions-2563eb)](#architecture)
[![Auth](https://img.shields.io/badge/auth-Clerk-6d28d9)](#authentication--data-storage)
[![Storage](https://img.shields.io/badge/storage-Azure%20Blob-0ea5e9)](#authentication--data-storage)
[![Web Search](https://img.shields.io/badge/search-Tavily-16a34a)](#web-search)
[![Python](https://img.shields.io/badge/python-3.13-3776ab)](#prerequisites)
[![Node](https://img.shields.io/badge/node-24.x-339933)](#prerequisites)

NeuralChat is a beginner-first AI workspace with secure login, streaming responses, user-scoped cloud memory, optional web search with citations, file/PDF upload Q&A, and plan-first agent execution.

This repository is organized as a workspace root with implementation inside [`NeuralChat/`](./NeuralChat).

## Project Status

As of **March 12, 2026**, the following are implemented and working:

- Clerk login/logout frontend shell (signed-in and signed-out views)
- Backend JWT verification for Clerk bearer tokens via JWKS
- Public `GET /api/health` and `GET /api/search/status`
- Auth-required `POST /api/chat`, `GET /api/me`, `PATCH /api/me/memory`, `DELETE /api/me/memory`, `DELETE /api/conversations/{session_id}`
- Auth-required file APIs: `POST /api/upload`, `GET /api/files`, `DELETE /api/files/{filename}`
- NDJSON streaming (`token`, `done`, `error`) with metrics (`response_ms`, `first_token_ms`, `tokens_emitted`, `status`)
- Azure Blob conversation persistence scoped by stable `user_id/session_id` and cleaned up by backend when a chat is deleted
- Deep Memory profile facts extraction + prompt injection for chat
- Tavily web search integration with 24-hour Blob cache (`search-cache/{sha256(query)}.json`)
- Frontend web-search UX: sidebar control, per-message search badge, expandable source citations
- Azure OpenAI GPT-5 path only (`model: "gpt-5"`, deployment example `gpt-5-chat`)
- File upload pipeline (raw + parsed chunks in Blob) with session-scoped retrieval
- Chat file-context injection and `📄` badge when file context is used
- Agent Mode with LangChain + LangGraph:
  - `POST /api/agent/plan`
  - `POST /api/agent/run/{plan_id}`
  - `GET /api/agent/history`
  - `GET /api/agent/history/{plan_id}`
- Agent plan preview, explicit `Run plan`, streamed step execution, and final summary
- Agent plan/log persistence in Blob
- Deployed Azure Function backend smoke-tested successfully for auth, chat, search, file upload/list/delete, and file-context chat

## Architecture

- **Frontend:** Vite + React + TypeScript + Tailwind CSS + Clerk React SDK
- **Backend:** FastAPI mounted in Azure Functions (`AsgiFunctionApp`)
- **Auth:** Clerk JWT (`Authorization: Bearer <token>`)
- **Providers:** Azure OpenAI GPT-5 only
- **Storage:** Azure Blob
  - `neurarchat-memory` (conversations + search cache)
  - `neurarchat-profiles` (user profile facts)
  - `neurarchat-uploads` (raw uploaded files)
  - `neurarchat-parsed` (parsed chunk JSON)
  - `neurarchat-agents` (agent plans + execution logs)

## Deployment Status

Current hosted backend used by local frontend:

- `https://neural-chat-emg6cva3befyayd4.eastus-01.azurewebsites.net`

Smoke-tested on **March 12, 2026**:

- `GET /api/health`
- `GET /api/search/status`
- `GET /api/me`
- `POST /api/chat` (normal)
- `POST /api/chat` with `force_search: true`
- `POST /api/upload`
- `GET /api/files`
- `DELETE /api/files/{filename}`
- Streamed chat with uploaded file context (`file_context_used: true`)

Result: deployed backend is operational and compatible with the current frontend API contract.

## Authentication & Data Storage

How login works:

1. Signed-out users see Clerk `SignIn`.
2. Clerk validates credentials and issues a session token.
3. Frontend sends token on protected API calls.
4. Backend verifies token via Clerk JWKS.
5. Backend reads `sub` as `user_id` and scopes all storage to that user.

Where data is stored:

- **Credentials and sessions:** Clerk
- **Chat history / memory profiles / search cache metadata:** Azure Blob
- **Uploaded files + parsed chunks:** Azure Blob

## Web Search

NeuralChat supports:

- **Auto decision logic** in the backend (`should_search`)
- **Manual Web search control** in the left sidebar under `New chat`

Behavior:

- Search results are cached for 24 hours in Blob.
- If search is used, UI shows a search badge and a collapsible Sources section.
- If force-search is enabled and no results are found, backend returns a clear web-only message instead of silently falling back.

## File Upload Q&A Flow

When a user uploads a document:

1. Frontend calls `POST /api/upload` with multipart data (`session_id`, `file`).
2. Backend validates file type and 25MB size limit.
3. Raw file is stored in the session-scoped uploads container for that authenticated user and chat.
4. Parsed chunks are reused from `neurarchat-parsed` if already available; otherwise backend parses and chunks the file, then saves parsed JSON.
5. On `POST /api/chat`, backend loads session file chunks and injects top relevant chunks into the GPT system prompt.
6. Response metadata includes `file_context_used`; frontend shows `📄` badge on that assistant message.

Important session rule:

- uploaded files are scoped to `user_id + session_id`
- files added in one chat stay in that chat only
- starting a new chat creates a separate file set

## Chat Deletion Cleanup

Deleting a chat is a real backend cleanup operation, not just a frontend/sidebar removal.

The frontend calls:

- `DELETE /api/conversations/{session_id}`

The backend then deletes all session-scoped artifacts for that authenticated user:

- conversation history for that session
- raw uploaded files for that session
- parsed file chunks for that session
- agent plans for that session
- agent execution logs for that session

What is intentionally not deleted:

- user-level profile memory in `neurarchat-profiles`

That profile memory belongs to the user account, not to an individual chat session.

## Agent Mode

Agent Mode is a separate workflow from normal chat:

1. User turns on `Agent mode` from the left sidebar under `Codex`.
2. User submits a goal instead of a normal prompt.
3. Backend creates a plan first and returns it to the UI.
4. User explicitly clicks `Run plan`.
5. Backend streams:
   - plan
   - step start
   - step done / failed
   - warning
   - final summary
   - done
6. Plans and execution logs are stored in the session-scoped agents container for that user and chat.

Safety rules:

- max 6 steps
- loop detection stops repeated same-tool execution
- failed steps are logged but do not abort the whole task
- total execution timeout: 60 seconds

## Repository Layout

```text
PROJECT/
├── NeuralChat/
│   ├── backend/
│   ├── frontend/
│   ├── docs/
│   └── journal/
└── README.md
```

## Prerequisites

- Python 3.13+
- Node.js 24+
- npm 11+
- Azure Storage connection (or Azurite)
- Azure Functions Core Tools v4 (optional runtime path)

## Quick Start

### 1) Backend

```bash
cd /Users/hanan/Documents/PROJECT/NeuralChat/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 2) Frontend

```bash
cd /Users/hanan/Documents/PROJECT/NeuralChat/frontend
npm install
npm run dev
```

### 3) Optional Azure Functions Runtime

```bash
cd /Users/hanan/Documents/PROJECT/NeuralChat/backend
func start
```

## Configuration

Backend (`NeuralChat/backend/local.settings.json`):

- `AZURE_STORAGE_CONNECTION_STRING`
- `AZURE_BLOB_MEMORY_CONTAINER`
- `AZURE_BLOB_PROFILES_CONTAINER`
- `AZURE_BLOB_UPLOADS_CONTAINER`
- `AZURE_BLOB_PARSED_CONTAINER`
- `CLERK_JWKS_URL`
- `CLERK_ISSUER` (recommended)
- `CLERK_AUDIENCE` (optional)
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_DEPLOYMENT_NAME`
- `AZURE_OPENAI_API_VERSION`
- `TAVILY_API_KEY`

Frontend (`NeuralChat/frontend/.env`):

- `VITE_CLERK_PUBLISHABLE_KEY`
- `VITE_API_BASE_URL` (current hosted backend: `https://neural-chat-emg6cva3befyayd4.eastus-01.azurewebsites.net`)

## API Summary

- `GET /api/health` (public)
  - `{"status":"ok","timestamp":"...","version":"..."}`

- `GET /api/search/status` (public)
  - `{"search_enabled": true|false}`

- `GET /api/me` (auth required)
  - `{"user_id":"...","profile":{...}}`

- `PATCH /api/me/memory` (auth required)
  - Request: `{"key":"city","value":"Lahore"}`
  - Empty value removes a single key.

- `DELETE /api/me/memory` (auth required)
  - `{"message":"Memory cleared"}`

- `POST /api/chat` (auth required)
  - Request:
    - `session_id: string`
    - `message: string`
    - `model: "gpt-5"`
    - `stream: boolean`
    - `force_search?: boolean`
  - Stream chunks:
    - `{"type":"token","content":"..."}`
    - `{"type":"done",...,"search_used":true|false,"file_context_used":true|false,"sources":[...]}`
    - `{"type":"error","content":"...","request_id":"..."}`

- `POST /api/upload` (auth required, multipart)
  - Fields: `session_id`, `file`
  - Returns: `{"filename","blob_path","chunk_count","message"}`

- `GET /api/files` (auth required)
  - Query: `session_id`
  - Returns: `{"files":[{"filename","uploaded_at","blob_path"}]}`

- `DELETE /api/files/{filename}` (auth required)
  - Query: `session_id`
  - Returns: `{"message":"<filename> deleted successfully"}`

- `POST /api/agent/plan` (auth required)
  - Request: `{"goal":"...","session_id":"..."}`
  - Returns: `{"plan":{"plan_id":"...","goal":"...","steps":[...]}}`

- `POST /api/agent/run/{plan_id}` (auth required, NDJSON stream)
  - Request: `{"session_id":"..."}`
  - Stream chunks:
    - `{"type":"plan","plan":{...}}`
    - `{"type":"step_start","step_number":1,"description":"..."}`
    - `{"type":"step_done","step_number":1,"result":"...","status":"done|failed","error":null}`
    - `{"type":"warning","message":"..."}`
    - `{"type":"summary","content":"..."}`
    - `{"type":"done","plan_id":"...","steps_completed":2}`

- `GET /api/agent/history` (auth required)
  - Returns: `{"tasks":[{"plan_id","goal","created_at","steps_count"}]}`

- `GET /api/agent/history/{plan_id}` (auth required)
  - Returns: `{"plan":{...},"log":[...]}`

## Verification

Current local checks:

- Backend: `cd backend && .venv/bin/pytest -q tests`
- Frontend tests: `cd frontend && npm run test -- --run`
- Frontend build: `cd frontend && npm run build`

## Security Notes

- Never commit real credentials to tracked files.
- Keep production keys in secret stores.
- Rotate keys immediately if exposed.
- Treat pasted Clerk bearer tokens as compromised; regenerate them after any external sharing.
- Prefer Clerk JWT templates for smoke testing instead of short-lived default session tokens.

## Internal Docs

- Architecture details: [`NeuralChat/docs/ARCHITECTURE.md`](./NeuralChat/docs/ARCHITECTURE.md)
- Task roadmap: [`NeuralChat/docs/ROADMAP.md`](./NeuralChat/docs/ROADMAP.md)
- Deployment checklist: [`NeuralChat/docs/DEPLOYMENT.md`](./NeuralChat/docs/DEPLOYMENT.md)
- Learning log template: [`NeuralChat/journal/BUG_JOURNAL.md`](./NeuralChat/journal/BUG_JOURNAL.md)
