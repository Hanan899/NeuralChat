# NeuralChat Deployment

This document describes the current local setup and Azure deployment model for NeuralChat.

## Runtime Shape

- Frontend runs as a Vite app during development.
- Backend runs as FastAPI mounted through Azure Functions ASGI.
- Local backend can run either with Azure Functions Core Tools or directly with Uvicorn.
- The current hosted backend example is:
  - `https://neural-chat-emg6cva3befyayd4.eastus-01.azurewebsites.net`

## Local Setup

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
func start
```

Optional direct FastAPI run:

```bash
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Environment Configuration

### Frontend `.env`

Required values:

- `VITE_CLERK_PUBLISHABLE_KEY`
- `VITE_API_BASE_URL`

Current example from `.env.example`:

```env
VITE_CLERK_PUBLISHABLE_KEY=pk_test_your_key_here
VITE_API_BASE_URL=https://neural-chat-emg6cva3befyayd4.eastus-01.azurewebsites.net
```

Alternate local backend examples:

- `http://localhost:7071` for `func start`
- `http://localhost:8000` for `uvicorn`

### Backend `local.settings.json`

Required values from `local.settings.example.json`:

- `FUNCTIONS_WORKER_RUNTIME=python`
- `AzureWebJobsStorage`
- `AZURE_STORAGE_CONNECTION_STRING`
- `AZURE_BLOB_MEMORY_CONTAINER`
- `AZURE_BLOB_PROFILES_CONTAINER`
- `AZURE_BLOB_UPLOADS_CONTAINER`
- `AZURE_BLOB_PARSED_CONTAINER`
- `AZURE_BLOB_AGENTS_CONTAINER`
- `CLERK_JWKS_URL`
- `CLERK_ISSUER`
- `CLERK_AUDIENCE`
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_DEPLOYMENT_NAME`
- `AZURE_OPENAI_API_VERSION`
- `TAVILY_API_KEY`
- `MOCK_STREAM_DELAY_MS`

## Azure Function App Settings

Set the same backend settings in Azure Application Settings.

At minimum:

- `AzureWebJobsStorage`
- `AZURE_STORAGE_CONNECTION_STRING`
- `AZURE_BLOB_MEMORY_CONTAINER`
- `AZURE_BLOB_PROFILES_CONTAINER`
- `AZURE_BLOB_UPLOADS_CONTAINER`
- `AZURE_BLOB_PARSED_CONTAINER`
- `AZURE_BLOB_AGENTS_CONTAINER`
- `CLERK_JWKS_URL`
- `CLERK_ISSUER`
- `CLERK_AUDIENCE`
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_DEPLOYMENT_NAME`
- `AZURE_OPENAI_API_VERSION`
- `TAVILY_API_KEY`
- `FUNCTIONS_WORKER_RUNTIME=python`

## CORS

When the frontend runs locally and the backend runs on Azure, the backend must allow the frontend origin.

Typical local origins:

- `http://localhost:5173`
- `http://127.0.0.1:5173`

Backend CORS is configured through `CORS_ALLOW_ORIGINS` and FastAPI CORS middleware.

If the frontend is later hosted elsewhere, add that hosted origin too.

## Azure Deployment Flow

NeuralChat backend is designed for Azure Functions remote build.

Recommended command:

```bash
cd backend
func azure functionapp publish Neural-Chat --build remote --verbose
```

This is the preferred deployment path because it exposes real build and sync-trigger logs, which are more reliable than relying only on the VS Code Azure pane.

## Flex Consumption Notes

The project is compatible with Azure Functions Flex Consumption deployment and Python remote build.

Key runtime files:

- `backend/function_app.py`
- `backend/host.json`
- `backend/requirements.txt`

## Public and Protected Endpoints to Verify

### Public

- `GET /api/health`
- `GET /api/search/status`

### Protected

- `POST /api/conversations/title`
- `GET /api/me`
- `PATCH /api/me/memory`
- `DELETE /api/me/memory`
- `POST /api/upload`
- `GET /api/files?session_id=...`
- `DELETE /api/files/{filename}?session_id=...`
- `DELETE /api/conversations/{session_id}`
- `POST /api/agent/plan`
- `POST /api/agent/run/{plan_id}`
- `GET /api/agent/history`
- `GET /api/agent/history/{plan_id}`
- `POST /api/chat`

Protected requests can also include:

- `X-User-Display-Name`
- `X-Session-Title`

## Smoke Test Checklist

### Public checks

```bash
curl https://neural-chat-emg6cva3befyayd4.eastus-01.azurewebsites.net/api/health
curl https://neural-chat-emg6cva3befyayd4.eastus-01.azurewebsites.net/api/search/status
```

### Browser checks

- sign in through Clerk
- send a normal chat message
- toggle sidebar `Web search` and verify a search-backed answer
- upload a file and verify file listing
- ask a file-grounded question and verify file context is used
- create an agent plan and run it
- open `Agents` history panel
- delete a chat and verify the session disappears from UI and backend cleanup succeeds

### Authenticated API checks

Use a valid Clerk bearer token to test:

- `/api/me`
- `/api/chat`
- `/api/upload`
- `/api/files`
- `/api/conversations/{session_id}`
- `/api/agent/*`

## Clerk Testing Notes

Default Clerk session tokens are short-lived. For terminal smoke testing, create a Clerk JWT template such as `smoke_test` with a longer lifetime, then request a token with:

```js
await window.Clerk.session.getToken({
  template: "smoke_test",
  skipCache: true,
})
```

## Common Failure Cases

### `401 Invalid authentication token`

Usually caused by one of:

- expired Clerk token
- incorrect `CLERK_JWKS_URL`
- incorrect `CLERK_ISSUER`
- mismatched audience validation

### Browser shows offline or blocked requests

Usually caused by one of:

- incorrect `VITE_API_BASE_URL`
- missing CORS origin in Azure
- deployed backend URL mismatch

### Azure Functions unhealthy storage errors

Usually caused by one of:

- invalid `AzureWebJobsStorage`
- invalid storage connection string
- local emulator issues when using development storage locally

### Delete chat returns `Not Found`

Usually caused by one of:

- frontend still pointing at an older backend deployment
- frontend dev server using stale environment state
- backend route not yet redeployed after local changes

## Secret Handling

- Keep live secrets out of docs and screenshots.
- Do not commit real `local.settings.json` or `.env` values.
- Rotate any real token or key that is pasted into chat, terminal output, or public logs.
