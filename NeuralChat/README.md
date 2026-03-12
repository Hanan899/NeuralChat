# NeuralChat

Beginner-first AI chat app with secure login, streaming responses, deep memory, and optional web search with citations.

## Current Scope

- Frontend: Vite + React + TypeScript + Tailwind
- Auth: Clerk (Email/Password sign-in + logout)
- Backend: FastAPI behind Azure Functions
- Storage: Azure Blob per user/session
- Model: Azure OpenAI GPT-5 only (`model: "gpt-5"`, deployment example `gpt-5-chat`)
- Search: Tavily with 24-hour Blob cache

## Current Deployment

- Local frontend is configured to call:
  - `https://neural-chat-emg6cva3befyayd4.eastus-01.azurewebsites.net`
- This deployed backend was smoke-tested on **March 12, 2026** and passed:
  - auth profile read
  - normal GPT-5 chat
  - Tavily-backed forced web search
  - file upload
  - file list
  - file delete
  - streamed file-context chat

## Core Features Implemented

- Authenticated streaming chat (`token`, `done`, `error` chunks)
- User-scoped conversation persistence
- Deep Memory profile extraction and injection into prompts
- Memory controls:
  - `GET /api/me`
  - `PATCH /api/me/memory`
  - `DELETE /api/me/memory`
- Web search flow:
  - Auto decision (`should_search`)
  - Force search from frontend toggle (`force_search`)
  - Search cache in `neurarchat-memory/search-cache/{hash}.json`
  - Source citations returned to frontend
- Search UX:
  - Nav status dot (`GET /api/search/status`)
  - `🌐` badge on assistant messages when search is used
  - Collapsible Sources panel below assistant message
- File upload flow:
  - `POST /api/upload` (session-scoped multipart upload)
  - `GET /api/files` and `DELETE /api/files/{filename}`
  - Parsed chunk reuse in `neurarchat-parsed`
  - `📄` badge on assistant messages when uploaded-file context is used

## What Happens When You Upload a Document

1. Frontend sends multipart data to `POST /api/upload` with `session_id` + `file`.
2. Backend validates extension and max size (25MB).
3. Raw file is saved to Blob: `neurarchat-uploads/{user_id}/{session_id}/{filename}`.
4. Backend checks parsed cache in `neurarchat-parsed`:
   - if found, parsed chunks are reused
   - if missing, file text is extracted and chunked, then saved
5. Later on `/api/chat`, backend loads parsed chunks for that session and injects only the most relevant chunks into the GPT system prompt.
6. If file context is used in the answer, stream metadata sets `file_context_used: true` and frontend shows `📄`.

## How Login Works

1. Signed-out user sees Clerk login page.
2. Clerk validates credentials and issues a session token.
3. Frontend sends `Authorization: Bearer <token>` for protected calls.
4. Backend verifies JWT using Clerk JWKS.
5. Backend extracts `user_id` (`sub`) and scopes all storage operations to that user.

Where data is stored:

- Credentials and auth sessions: **Clerk**
- App chat/profile/search-cache data: **Azure Blob Storage**

## API Endpoints

- `GET /api/health` (public)
- `GET /api/search/status` (public)
- `GET /api/me` (auth required)
- `PATCH /api/me/memory` (auth required)
- `DELETE /api/me/memory` (auth required)
- `POST /api/chat` (auth required)
- `POST /api/upload` (auth required, multipart)
- `GET /api/files` (auth required)
- `DELETE /api/files/{filename}` (auth required)

`/api/chat` request body:

```json
{
  "session_id": "string",
  "message": "string",
  "model": "gpt-5",
  "stream": true,
  "force_search": false
}
```

Stream response format (NDJSON):

- `{"type":"token","content":"..."}`
- `{"type":"done","request_id":"...","response_ms":123,"first_token_ms":45,"tokens_emitted":99,"status":"completed","search_used":true,"file_context_used":true,"sources":[...]}`
- `{"type":"error","content":"...","request_id":"..."}`

Notes:

- If force search is ON and no web results are found, backend returns a clear web-only message.
- If Tavily is unavailable, backend returns a clear provider-unavailable message.

## Storage Layout

- Container `neurarchat-memory`:
  - `conversations/{user_id}/{session_id}.json`
  - `search-cache/{sha256(normalized_query)}.json`
- Container `neurarchat-profiles`:
  - `profiles/{user_id}.json`
- Container `neurarchat-uploads`:
  - `{user_id}/{session_id}/{filename}`
- Container `neurarchat-parsed`:
  - `{user_id}/{session_id}/{filename}.json`

## Folder Structure

- `frontend/` UI, auth shell, streaming, search badges/sources
- `backend/` APIs, auth verification, provider routing, memory/search services, blob persistence
- `docs/` architecture + roadmap
- `journal/` learning and debugging notes

## Backend Quick Start

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## Frontend Quick Start

```bash
cd frontend
npm install
npm run dev
```

## Configuration

### Frontend (`frontend/.env`)

- `VITE_CLERK_PUBLISHABLE_KEY`
- `VITE_API_BASE_URL` (current hosted backend: `https://neural-chat-emg6cva3befyayd4.eastus-01.azurewebsites.net`)

### Backend (`backend/local.settings.json`)

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

## Testing

- Backend: `cd backend && .venv/bin/pytest -q tests`
- Frontend tests: `cd frontend && npm run test -- --run`
- Frontend build: `cd frontend && npm run build`

## Deployment Checklist

See [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) for:

- Azure Function app settings
- CORS requirements for local frontend
- Clerk JWT template setup for longer-lived smoke test tokens
- secret/token handling rules

## Grip Workflow

Use this structure for every coding session:

`Goal -> What you type -> Why it works -> Break test -> Own rewrite`
