# NeuralChat Architecture (Auth + Memory + Search + File Upload + Agent Mode)

## 1) Runtime Components

- `frontend/`:
  - React + TypeScript + Tailwind + Clerk
  - Streams assistant tokens, manages conversation UI, sidebar mode controls, file upload modal, and agent progress/history
- `backend/`:
  - FastAPI mounted in Azure Functions ASGI
  - Auth verification, chat orchestration, prompt assembly, agent execution, Blob persistence
- `Azure Blob Storage` containers:
  - `neurarchat-memory` (conversations + search cache)
  - `neurarchat-profiles` (deep memory profile)
  - `neurarchat-uploads` (raw uploaded files)
  - `neurarchat-parsed` (parsed chunk JSON)
  - `neurarchat-agents` (agent plans + execution logs)

## 2) Auth and Identity Flow

1. User signs in with Clerk.
2. Frontend gets Clerk session token.
3. Frontend calls protected APIs with `Authorization: Bearer <token>`.
4. Backend validates JWT using Clerk JWKS.
5. Backend derives `user_id` from token `sub` claim.
6. All chat/file/profile storage is scoped by `user_id`.

## 3) Chat Request Pipeline (`POST /api/chat`)

1. Validate request body (`session_id`, `message`, `model`, `stream`, optional `force_search`).
2. Persist user message to conversation blob.
3. Build memory prompt from profile facts.
4. If force-search is enabled from the sidebar `Web search` control, load/search/cached web sources and build search prompt.
5. Load uploaded files for `(user_id, session_id)`, read parsed chunks, rank relevant chunks, and build file prompt.
6. Compose model system context in this exact order:
   - memory facts
   - web search context
   - relevant uploaded-file context
   - base instructions
7. Call Azure OpenAI GPT-5 and stream NDJSON chunks.
8. Persist assistant message + metadata (`search_used`, `file_context_used`, timing metrics, sources).
9. Trigger async memory extraction/update in background.

### Chat deletion path

When a user deletes a chat from the frontend, the UI calls:

- `DELETE /api/conversations/{session_id}`

That endpoint performs real backend cleanup for that authenticated user and session:

- removes the conversation blob
- removes raw uploaded files for that session
- removes parsed file chunks for that session
- removes agent plans for that session
- removes agent execution logs for that session

It does not remove user-level profile memory, because profile memory is account-scoped rather than session-scoped.

## 4) File Upload Pipeline (`POST /api/upload`)

1. Frontend sends multipart form with:
   - `session_id`
   - `file`
2. Backend validates extension and size (max 25MB).
3. Backend uploads raw file to a session-scoped uploads path for that authenticated user and chat.
4. Backend checks if parsed blob already exists:
   - if yes: reuse parsed chunks (no re-parse)
   - if no: parse text -> chunk text -> save to parsed blob
5. Backend returns `filename`, `blob_path`, `chunk_count`, and success message.

## 5) API Surface

- Public:
  - `GET /api/health`
  - `GET /api/search/status`
- Auth required:
  - `GET /api/me`
  - `PATCH /api/me/memory`
  - `DELETE /api/me/memory`
  - `POST /api/chat`
  - `DELETE /api/conversations/{session_id}`
  - `POST /api/upload`
  - `GET /api/files?session_id=...`
  - `DELETE /api/files/{filename}?session_id=...`
  - `POST /api/agent/plan`
  - `POST /api/agent/run/{plan_id}`
  - `GET /api/agent/history`
  - `GET /api/agent/history/{plan_id}`

## 6) Stream Contracts

- Token chunk:
  - `{"type":"token","content":"..."}`
- Done chunk:
  - `{"type":"done", "request_id":"...", "response_ms":..., "first_token_ms":..., "tokens_emitted":..., "status":"completed|interrupted", "search_used":true|false, "file_context_used":true|false, "sources":[...]}`
- Error chunk:
  - `{"type":"error","content":"...","request_id":"..."}`

## 7) Frontend To Deployed Backend Path

Current local frontend runtime points to:

- `VITE_API_BASE_URL=https://neural-chat-emg6cva3befyayd4.eastus-01.azurewebsites.net`

Flow:

1. Local Vite frontend runs on `http://localhost:5173`.
2. Browser sends requests to deployed Azure Function backend.
3. Azure backend must allow local frontend origin through CORS.
4. Protected calls include Clerk bearer token.
5. Backend verifies token, runs chat/search/file pipeline, and returns JSON or NDJSON stream.

## 8) Agent Mode Pipeline

1. User enables `Agent mode` from the left sidebar under `Codex`.
2. Frontend sends `POST /api/agent/plan` with:
   - `goal`
   - `session_id`
3. Backend creates a plan using GPT-5 and truncates to max 6 steps.
4. Frontend shows plan preview in-thread and waits for explicit `Run plan`.
5. Frontend calls `POST /api/agent/run/{plan_id}`.
6. Backend executes steps sequentially with LangGraph using:
   - `web_search`
   - `read_file`
   - `memory_recall`
   - reasoning-only steps
7. Backend streams:
   - `plan`
   - `step_start`
   - `step_done`
   - `warning`
   - `summary`
   - `done`
8. Backend stores plan and execution log artifacts in session-scoped paths inside `neurarchat-agents`.

Safety constraints:

- max 6 steps
- repeated same tool + same input -> stop early with warning
- failed steps are logged, not fatal
- total timeout: 60 seconds

## 9) Deployment Verification

The deployed backend was smoke-tested on **March 12, 2026** and passed:

- profile fetch
- authenticated GPT-5 chat
- forced Tavily search
- file upload
- file list
- file delete
- streamed file-context response
