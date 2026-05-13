# NeuralChat Codex Brief

Read this file first for future feature work. It is meant to reduce repo re-discovery, not replace targeted file reads in the area being changed.

## Purpose

Use this as the quick map for:
- where the app entrypoints live
- which files own each feature
- how local dev and tests are run
- which parts of the repo are easy to break by accident

For any new feature, read this file first, then read only the files in the relevant section below.

## Repo Shape

- `frontend/`: React 18 + TypeScript + Vite app
- `backend/`: FastAPI app mounted through Azure Functions
- `docs/`: architecture, deployment, roadmap
- Root scripts: `start-frontend.sh`, `publish-backend.sh`, `Makefile`

## Current Runtime Model

- Frontend talks to backend over HTTP with Clerk bearer tokens.
- Backend default local URL from the frontend side is `http://localhost:7071`.
- Backend is a FastAPI app wrapped by Azure Functions ASGI in `backend/function_app.py`.
- Main backend route surface lives in `backend/app/main.py`.
- The app has two major product layers:
  - the main chat workspace
  - the newer platform/admin surface in `backend/app/routers/platform.py`

## Start Here By Task

### If the request is about chat

Read:
- `frontend/src/App.tsx`
- `frontend/src/api.ts`
- `frontend/src/components/ChatWindow.tsx`
- `backend/app/main.py`
- `backend/app/services/chat_service.py`
- `backend/app/services/search.py`
- `backend/app/services/file_handler.py`
- `backend/app/services/memory.py`

Notes:
- `POST /api/chat` is the main chat endpoint.
- Responses stream as NDJSON.
- Chat can include search, file context, global memory, and project context.

### If the request is about projects / Project Brain

Read:
- `frontend/src/pages/ProjectsPage.tsx`
- `frontend/src/pages/ProjectWorkspacePage.tsx`
- `frontend/src/api/projects.ts`
- `frontend/src/components/ProjectBrainPanel.tsx`
- `backend/app/main.py`
- `backend/app/services/projects.py`

Notes:
- Project templates and their memory keys are defined in `backend/app/services/projects.py`.
- Project chats, project memory, project files, and Project Brain logs are all isolated from global chat.

### If the request is about Agent Mode

Read:
- `frontend/src/pages/AgentStudioPage.tsx`
- `frontend/src/pages/AgentSessionsPage.tsx`
- `frontend/src/api/agent.ts`
- `frontend/src/components/AgentHistory.tsx`
- `frontend/src/components/AgentProgress.tsx`
- `backend/app/main.py`
- `backend/app/services/agent.py`

Notes:
- Agent flow is plan first, then explicit run.
- Agent endpoints include `/api/agent/plan`, `/api/agent/run/{plan_id}`, `/api/agent/confirm/{plan_id}`, and history routes.

### If the request is about auth / access / settings / cost controls

Read:
- `frontend/src/hooks/useAccess.ts`
- `frontend/src/components/SettingsPanel.tsx`
- `frontend/src/components/AccessManagementPanel.tsx`
- `frontend/src/api/usage.ts`
- `frontend/src/api/members.ts`
- `backend/app/access.py`
- `backend/app/auth.py`
- `backend/app/routers/members.py`
- `backend/app/services/cost_tracker.py`

Notes:
- Clerk provides auth.
- Owners can manage roles, feature overrides, and spend limits.

### If the request is about platform providers / tools / documents / collections

Read:
- `backend/app/routers/platform.py`
- `backend/app/platform/`

Notes:
- This is a separate backend surface from the core chat app.
- `backend/function_app.py` also wires a queue worker for platform document indexing when platform config is enabled.

## Frontend Map

Key files:
- `frontend/src/main.tsx`: app bootstrap, Clerk, React Query, router mount
- `frontend/src/App.tsx`: main signed-in shell, global state, main workspace behavior
- `frontend/src/api.ts`: base API helpers, auth headers, streaming chat client
- `frontend/src/api/projects.ts`: project API client
- `frontend/src/api/agent.ts`: agent API client and stream handling
- `frontend/src/pages/`: route-level views
- `frontend/src/components/`: reusable UI blocks
- `frontend/src/hooks/`: shared hooks such as API access and prefetching

Important behavior:
- Protected requests use `Authorization: Bearer <token>`.
- Some requests also send:
  - `X-User-Display-Name`
  - `X-Session-Title`
- These extra headers are for readable storage naming, not identity.

## Backend Map

Key files:
- `backend/function_app.py`: Azure Functions entrypoint
- `backend/app/main.py`: primary API routes
- `backend/app/schemas.py`: request validation helpers
- `backend/app/services/chat_service.py`: GPT chat generation and streaming
- `backend/app/services/memory.py`: global profile memory
- `backend/app/services/projects.py`: projects, project chats, Project Brain, project files
- `backend/app/services/agent.py`: planning/execution/history
- `backend/app/services/file_handler.py`: upload, parse, chunking, retrieval
- `backend/app/services/search.py`: Tavily-backed search and cache
- `backend/app/services/storage.py`: conversation persistence
- `backend/app/services/cost_tracker.py`: token and spend tracking
- `backend/app/routers/members.py`: access management endpoints
- `backend/app/routers/platform.py`: platform/admin/provider/tool/document routes

## Core API Surface

Main routes in `backend/app/main.py`:
- Health: `/api/health`
- Chat: `/api/chat`
- Search status: `/api/search/status`
- Conversations: `/api/conversations`, `/api/conversations/{session_id}`
- Files: `/api/upload`, `/api/files`, `/api/files/{filename}`
- Profile memory: `/api/me`, `/api/me/memory`
- Usage: `/api/usage/*`
- Projects: `/api/projects/*`
- Agents: `/api/agent/*`

Extra routers:
- Members: `/api/members/*`
- Platform/admin: routes defined in `backend/app/routers/platform.py`

## Storage / Data Model

From the current docs and code:
- Global conversations, project metadata, project chats, usage, and search cache live in Azure Blob storage.
- Global user memory is profile-scoped.
- Project memory is separate from global memory.
- File uploads are stored raw and also stored as parsed chunks for retrieval.
- Agent plans and logs have their own storage area.

Path naming uses readable segments that still embed stable ids. Relevant helpers live in:
- `backend/app/services/blob_paths.py`

## Local Dev Commands

Frontend:
```bash
./start-frontend.sh
```

Backend bootstrap and tests:
```bash
make backend-bootstrap
make backend-test
```

Frontend tests:
```bash
make frontend-test
```

All tests:
```bash
make test
```

## Repo Quirks To Remember

- `frontend/src/api.ts` assumes the local backend is on `http://localhost:7071` unless `VITE_API_BASE_URL` is set.
- `start-frontend.sh` checks for `frontend/.env` and auto-installs `node_modules` if needed.
- `Makefile` references `./start-backend.sh`, but that file was not present in the repo snapshot when this brief was written.
- `run-dev.sh` was also not present in the repo snapshot when this brief was written.
- The repo may already contain user WIP. Check `git status --short` before editing and never revert unrelated changes.

## Suggested Workflow For Future Feature Requests

1. Read `codex.md`.
2. Identify the feature area from the sections above.
3. Read only the owning files for that area.
4. Check `git status --short` before editing.
5. Implement the change.
6. Run the smallest relevant test command first, then broader tests if needed.

## If You Need More Product Context

Read next:
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/DEPLOYMENT.md`

