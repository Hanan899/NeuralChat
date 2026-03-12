# NeuralChat

Beginner-first AI chat app with secure login, streaming responses, deep memory, and optional web search with citations.

## Current Scope

- Frontend: Vite + React + TypeScript + Tailwind
- Auth: Clerk (Email/Password sign-in + logout)
- Backend: FastAPI behind Azure Functions
- Storage: Azure Blob per user/session
- Model: Azure OpenAI GPT-5 only (`model: "gpt-5"`, deployment example `gpt-5-chat`)
- Search: Tavily with 24-hour Blob cache

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
- `{"type":"done","request_id":"...","response_ms":123,"first_token_ms":45,"tokens_emitted":99,"status":"completed","search_used":true,"sources":[...]}`
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
- `VITE_API_BASE_URL` (default `http://localhost:7071` for `func start`)

### Backend (`backend/local.settings.json`)

- `AZURE_STORAGE_CONNECTION_STRING`
- `AZURE_BLOB_MEMORY_CONTAINER`
- `AZURE_BLOB_PROFILES_CONTAINER`
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

## Grip Workflow

Use this structure for every coding session:

`Goal -> What you type -> Why it works -> Break test -> Own rewrite`
