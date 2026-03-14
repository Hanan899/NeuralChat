# NeuralChat Deployment Checklist

## Target

- Backend host: `https://neural-chat-emg6cva3befyayd4.eastus-01.azurewebsites.net`
- Local frontend host during development: `http://localhost:5173`

## 1. Azure Function App Settings

Set these in Azure Application Settings:

- `AzureWebJobsStorage`
- `AZURE_STORAGE_CONNECTION_STRING`
- `AZURE_BLOB_MEMORY_CONTAINER=neurarchat-memory`
- `AZURE_BLOB_PROFILES_CONTAINER=neurarchat-profiles`
- `AZURE_BLOB_UPLOADS_CONTAINER=neurarchat-uploads`
- `AZURE_BLOB_PARSED_CONTAINER=neurarchat-parsed`
- `AZURE_BLOB_AGENTS_CONTAINER=neurarchat-agents`
- `CLERK_JWKS_URL`
- `CLERK_ISSUER`
- `CLERK_AUDIENCE` (leave empty unless you enforce audience validation)
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_DEPLOYMENT_NAME`
- `AZURE_OPENAI_API_VERSION`
- `TAVILY_API_KEY`
- `FUNCTIONS_WORKER_RUNTIME=python`

## 2. Azure CORS

Allow at least:

- `http://localhost:5173`
- `http://127.0.0.1:5173`

If you later host the frontend, add the production frontend origin too.

## 3. Frontend Environment

Use this in `frontend/.env`:

```env
VITE_API_BASE_URL=https://neural-chat-emg6cva3befyayd4.eastus-01.azurewebsites.net
```

Current frontend control layout:

- sidebar: `Web search` under `New chat`
- sidebar: `Agent mode` under `Codex`
- top bar: `Agents`, `Share`, model selector, `Debug`
- composer: `Add files`, textarea, send or stop

## 4. Clerk Smoke-Test Token Setup

Default Clerk session tokens are too short for terminal smoke tests. Use a JWT template.

Create template:

- name: `smoke_test`
- lifetime: `600` seconds or more
- claims: `{}`

Get token in browser console:

```js
await window.Clerk.session.getToken({
  template: "smoke_test",
  skipCache: true,
})
```

## 5. Smoke Test Checklist

Public endpoints:

- `GET /api/health`
- `GET /api/search/status`

Authenticated endpoints:

- `GET /api/me`
- `POST /api/chat`
- `DELETE /api/conversations/{session_id}`
- `POST /api/chat` with `force_search: true`
- `POST /api/upload`
- `GET /api/files?session_id=...`
- `DELETE /api/files/{filename}?session_id=...`
- streamed `POST /api/chat` using uploaded-file context
- `POST /api/agent/plan`
- streamed `POST /api/agent/run/{plan_id}`
- `GET /api/agent/history`
- `GET /api/agent/history/{plan_id}`

## 6. Verified Result On March 12, 2026

The deployed backend passed:

- auth verification through Clerk template token
- GPT-5 standard chat
- real chat deletion with backend cleanup
- Tavily-backed forced search with returned `sources`
- file upload and parsed chunk persistence
- file listing
- file deletion
- streamed file-context chat with `file_context_used: true`
- agent plan creation
- streamed agent execution with `plan`, `step_start`, `step_done`, `summary`, and `done`
- agent history retrieval from Blob-backed plan and log storage

## 7. Secret and Token Handling Rules

- Never paste real storage keys, OpenAI keys, Tavily keys, or Clerk bearer tokens into public channels.
- If any secret or bearer token is pasted into chat, terminal logs, screenshots, or Git history, rotate it.
- Use `local.settings.json`, `.env`, Azure App Settings, or a secret manager for real secrets.
- Keep `local.settings.example.json` and `.env.example` sanitized.

## 8. Common Failure Cases

### `401 Invalid authentication token`

Usually one of:

- Clerk token expired
- `CLERK_JWKS_URL` or `CLERK_ISSUER` mismatch
- wrong token type used

### Frontend shows `OFFLINE` or `Load failed`

Usually one of:

- wrong `VITE_API_BASE_URL`
- Azure CORS missing `http://localhost:5173`
- deployed backend unavailable

### Azure Functions unhealthy storage errors

Usually one of:

- invalid `AzureWebJobsStorage`
- storage account unavailable
- Azurite not running for local emulator mode
