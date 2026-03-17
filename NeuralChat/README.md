# NeuralChat

NeuralChat is a personal AI chat app with authenticated GPT-5 chat, deep memory, optional web search, session-scoped file retrieval, and plan-first Agent Mode. The current project is split into a Vite frontend and a FastAPI backend mounted through Azure Functions.

## Stack

- Frontend: Vite, React, TypeScript, Tailwind CSS, Clerk React
- Backend: FastAPI, Azure Functions ASGI, Azure Blob Storage
- Model provider: Azure OpenAI GPT-5
- Search provider: Tavily
- Agent orchestration: LangChain + LangGraph
- Auth: Clerk JWT verification with JWKS

## Project Layout

```text
NeuralChat/
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   └── services/
│   ├── function_app.py
│   ├── host.json
│   ├── local.settings.example.json
│   ├── requirements.txt
│   └── tests/
├── frontend/
│   ├── src/
│   ├── index.html
│   ├── package.json
│   └── .env.example
└── docs/
```

## Current Features

### Auth and identity

- Signed-out users authenticate with Clerk.
- Protected frontend requests send `Authorization: Bearer <token>`.
- Backend verifies the token and derives `user_id` from the Clerk `sub` claim.
- Protected requests can also send readable naming headers:
  - `X-User-Display-Name`
  - `X-Session-Title`

### Chat

- `POST /api/chat` supports GPT-5 chat with streaming NDJSON responses.
- Streamed chunks include `token`, `done`, and `error` events.
- Final chat metadata can include:
  - `search_used`
  - `file_context_used`
  - `sources`
  - timing metrics and token counts

### Deep Memory

- Memory is stored per user in Azure Blob Storage.
- Backend extracts facts from chat exchanges and saves profile fields such as:
  - `name`
  - `job`
  - `city`
  - `preferences`
  - `goals`
- Memory endpoints:
  - `GET /api/me`
  - `PATCH /api/me/memory`
  - `DELETE /api/me/memory`

### Web search

- Search availability is exposed by `GET /api/search/status`.
- Tavily search results are cached in Blob for reuse.
- The frontend exposes a sidebar `Web search` control under `New chat`.
- When search is used, assistant messages can include a search badge and sources list.

### File upload and retrieval

- Users upload files with `POST /api/upload` using multipart form data.
- Session-scoped file APIs:
  - `GET /api/files?session_id=...`
  - `DELETE /api/files/{filename}?session_id=...`
- Supported file flow:
  - raw upload saved to Blob
  - parsed text chunked and cached
  - relevant chunks injected into the chat prompt later
- Files remain scoped to the active chat session only.

### Hybrid conversation titles

- New conversations get an immediate local summary title in the frontend.
- After the first useful reply or agent plan, the frontend can refine the title by calling:
  - `POST /api/conversations/title`
- This keeps the UI responsive while still producing cleaner chat names over time.

### Agent Mode

- Agent Mode is separate from normal chat.
- The sidebar exposes `Agent mode` under `Codex`.
- The flow is plan-first:
  1. Create a plan
  2. Show the plan in-thread
  3. Let the user explicitly run it
  4. Stream live progress and final summary
- Endpoints:
  - `POST /api/agent/plan`
  - `POST /api/agent/run/{plan_id}`
  - `GET /api/agent/history`
  - `GET /api/agent/history/{plan_id}`
- Supported v1 tools:
  - `web_search`
  - `read_file`
  - `memory_recall`
  - reasoning-only steps
- Safety behavior:
  - max 6 steps
  - loop guard
  - failed steps are logged instead of aborting the whole task
  - 60-second execution timeout
  - fallback reasoning step if the planner returns no valid steps

## API Surface

### Public

- `GET /api/health`
- `GET /api/search/status`

### Auth required

- `POST /api/conversations/title`
- `GET /api/me`
- `PATCH /api/me/memory`
- `DELETE /api/me/memory`
- `POST /api/upload`
- `GET /api/files`
- `DELETE /api/files/{filename}`
- `DELETE /api/conversations/{session_id}`
- `POST /api/agent/plan`
- `POST /api/agent/run/{plan_id}`
- `GET /api/agent/history`
- `GET /api/agent/history/{plan_id}`
- `POST /api/chat`

## Storage Layout

NeuralChat stores readable names in Blob paths while keeping stable ids in every segment.

### Containers

- `neurarchat-memory`
- `neurarchat-profiles`
- `neurarchat-uploads`
- `neurarchat-parsed`
- `neurarchat-agents`

### Canonical path patterns

- Conversations:
  - `conversations/{display_name__user_id}/{session_title__session_id}.json`
- Profiles:
  - `profiles/{display_name__user_id}.json`
- Raw uploads:
  - `{display_name__user_id}/{session_title__session_id}/{filename}`
- Parsed chunks:
  - `{display_name__user_id}/{session_title__session_id}/{filename}.json`
- Agent plans:
  - `{display_name__user_id}/{session_title__session_id}/plans/{plan_id}.json`
- Agent logs:
  - `{display_name__user_id}/{session_title__session_id}/logs/{plan_id}.json`
- Search cache:
  - `search-cache/{sha256(normalized_query)}.json`

Legacy id-only blob names are migrated lazily on the next read or write.

## Delete Chat Behavior

Deleting a chat is a backend cleanup operation, not only a frontend UI removal.

The frontend calls:

- `DELETE /api/conversations/{session_id}`

The backend removes session-scoped artifacts for that authenticated user:

- conversation history
- raw uploaded files
- parsed file chunks
- agent plans
- agent execution logs

User-level memory in `neurarchat-profiles` is intentionally preserved.

## Frontend UI Behavior

Current top-level interaction model:

- Sidebar:
  - `New chat`
  - `Web search`
  - `Images`
  - `Apps`
  - `Deep research`
  - `Codex`
  - `Agent mode`
  - `Projects`
- Top bar:
  - `Agents`
  - `Share`
  - model selector
  - `Debug`
- Composer:
  - message input
  - `Add files`
  - send or stop button

## Local Development

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

## Configuration

### Frontend `.env`

- `VITE_CLERK_PUBLISHABLE_KEY`
- `VITE_API_BASE_URL`

Current example backend:

- `https://neural-chat-emg6cva3befyayd4.eastus-01.azurewebsites.net`

### Backend `local.settings.json`

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
- `FUNCTIONS_WORKER_RUNTIME`

## Tests

- Backend:
  - `cd backend && .venv/bin/pytest -q tests`
- Frontend tests:
  - `cd frontend && npm run test -- --run`
- Frontend production build:
  - `cd frontend && npm run build`

## Related Docs

- [Architecture](/Users/hanan/Documents/PROJECT/NeuralChat/docs/ARCHITECTURE.md)
- [Deployment](/Users/hanan/Documents/PROJECT/NeuralChat/docs/DEPLOYMENT.md)
- [Roadmap](/Users/hanan/Documents/PROJECT/NeuralChat/docs/ROADMAP.md)
