# NeuralChat

[![Status](https://img.shields.io/badge/status-active%20development-0a7ea4)](#project-status)
[![Frontend](https://img.shields.io/badge/frontend-React%20%2B%20Tailwind-38bdf8)](#architecture)
[![Backend](https://img.shields.io/badge/backend-FastAPI%20on%20Azure%20Functions-2563eb)](#architecture)
[![Auth](https://img.shields.io/badge/auth-Clerk-6d28d9)](#authentication--data-storage)
[![Storage](https://img.shields.io/badge/storage-Azure%20Blob-0ea5e9)](#authentication--data-storage)
[![Web Search](https://img.shields.io/badge/search-Tavily-16a34a)](#web-search)
[![Python](https://img.shields.io/badge/python-3.13-3776ab)](#prerequisites)
[![Node](https://img.shields.io/badge/node-24.x-339933)](#prerequisites)

NeuralChat is a beginner-first AI chat platform with secure login, streaming responses, user-scoped cloud memory, and optional web search with citations.

This repository is organized as a workspace root with implementation inside [`NeuralChat/`](./NeuralChat).

## Project Status

As of **March 12, 2026**, the following are implemented and working:

- Clerk login/logout frontend shell (signed-in and signed-out views)
- Backend JWT verification for Clerk bearer tokens via JWKS
- Public `GET /api/health` and `GET /api/search/status`
- Auth-required `POST /api/chat`, `GET /api/me`, `PATCH /api/me/memory`, `DELETE /api/me/memory`
- NDJSON streaming (`token`, `done`, `error`) with metrics (`response_ms`, `first_token_ms`, `tokens_emitted`, `status`)
- Azure Blob conversation persistence scoped by `user_id/session_id`
- Deep Memory profile facts extraction + prompt injection for chat
- Tavily web search integration with 24-hour Blob cache (`search-cache/{sha256(query)}.json`)
- Frontend web-search UX: status dot, per-message globe badge, expandable source citations
- Manual force web-search toggle in chat compose
- Azure OpenAI GPT-5 path only (`model: "gpt-5"`, deployment example `gpt-5-chat`)

## Architecture

- **Frontend:** Vite + React + TypeScript + Tailwind CSS + Clerk React SDK
- **Backend:** FastAPI mounted in Azure Functions (`AsgiFunctionApp`)
- **Auth:** Clerk JWT (`Authorization: Bearer <token>`)
- **Providers:** Azure OpenAI GPT-5 only
- **Storage:** Azure Blob
  - `neurarchat-memory` (conversations + search cache)
  - `neurarchat-profiles` (user profile facts)

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

## Web Search

NeuralChat supports two search modes per message:

- **Auto mode:** backend decides via a small GPT call (`should_search`).
- **Force mode (UI toggle):** backend always attempts web search.

Behavior:

- Search results are cached for 24 hours in Blob.
- If search is used, UI shows `🌐` badge and a collapsible Sources section.
- If force-search is enabled and no results are found, backend returns a clear web-only message (no silent fallback to model-only answer).

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
- `VITE_API_BASE_URL` (default for Functions runtime: `http://localhost:7071`)

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
    - `{"type":"done",...,"search_used":true|false,"sources":[...]}`
    - `{"type":"error","content":"...","request_id":"..."}`

## Verification

Current local checks:

- Backend: `cd backend && .venv/bin/pytest -q tests`
- Frontend tests: `cd frontend && npm run test -- --run`
- Frontend build: `cd frontend && npm run build`

## Security Notes

- Never commit real credentials to tracked files.
- Keep production keys in secret stores.
- Rotate keys immediately if exposed.

## Internal Docs

- Architecture details: [`NeuralChat/docs/ARCHITECTURE.md`](./NeuralChat/docs/ARCHITECTURE.md)
- Task roadmap: [`NeuralChat/docs/ROADMAP.md`](./NeuralChat/docs/ROADMAP.md)
- Learning log template: [`NeuralChat/journal/BUG_JOURNAL.md`](./NeuralChat/journal/BUG_JOURNAL.md)
