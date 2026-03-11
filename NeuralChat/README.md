# NeuralChat

Beginner-first AI chat app with secure login, token-streamed responses, and user-scoped cloud storage.

## Current Scope

- Frontend: Vite + React + TypeScript + Tailwind
- Auth: Clerk (Email/Password sign-in + logout)
- Backend: FastAPI behind Azure Functions
- Storage: Azure Blob per user/session
- Models: Claude + GPT-4o (Azure OpenAI path for `gpt4o`)

## How Login Works

1. Signed-out user sees Clerk login page.
2. Clerk validates credentials and issues a session token.
3. Frontend sends `Authorization: Bearer <token>` for protected API calls.
4. Backend verifies JWT using Clerk JWKS.
5. Backend extracts `user_id` (`sub`) and scopes all storage operations to that user.

Where data is stored:

- Credentials and auth sessions: **Clerk**
- App chat/profile data: **Azure Blob Storage**

## API Endpoints

- `GET /api/health` (public)
- `GET /api/me` (auth required)
- `POST /api/chat` (auth required)

`/api/chat` request body:

```json
{
  "session_id": "string",
  "message": "string",
  "model": "claude | gpt4o",
  "stream": true
}
```

Stream response format (NDJSON):

- `{"type":"token","content":"..."}`
- `{"type":"done","request_id":"...","response_ms":123,"first_token_ms":45,"tokens_emitted":99,"status":"completed"}`
- `{"type":"error","content":"...","request_id":"..."}`

## Storage Layout

- Container `neurarchat-memory`:
  - `conversations/{user_id}/{session_id}.json`
- Container `neurarchat-profiles`:
  - `profiles/{user_id}.json`

## Folder Structure

- `frontend/` UI, auth shell, stream rendering
- `backend/` APIs, auth verification, provider routing, blob persistence
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

## Grip Workflow

Use this structure for every coding session:

`Goal -> What you type -> Why it works -> Break test -> Own rewrite`
