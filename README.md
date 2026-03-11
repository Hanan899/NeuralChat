# NeuralChat

[![Status](https://img.shields.io/badge/status-active%20development-0a7ea4)](#project-status)
[![Frontend](https://img.shields.io/badge/frontend-React%20%2B%20Tailwind-38bdf8)](#architecture)
[![Backend](https://img.shields.io/badge/backend-FastAPI%20on%20Azure%20Functions-2563eb)](#architecture)
[![Auth](https://img.shields.io/badge/auth-Clerk-6d28d9)](#authentication--data-storage)
[![Storage](https://img.shields.io/badge/storage-Azure%20Blob-0ea5e9)](#authentication--data-storage)
[![Python](https://img.shields.io/badge/python-3.13-3776ab)](#prerequisites)
[![Node](https://img.shields.io/badge/node-24.x-339933)](#prerequisites)

NeuralChat is a beginner-first AI chat platform with secure login, streaming responses, and user-scoped cloud memory.

This repository is organized as a workspace root with implementation inside [`NeuralChat/`](./NeuralChat).

## Project Status

As of **March 11, 2026**, the following are implemented:

- Clerk-based authentication in frontend (signed-in / signed-out shells, login UI, logout)
- Backend JWT verification for Clerk bearer tokens via JWKS
- Public `GET /api/health` endpoint
- Auth-required `POST /api/chat` endpoint
- Auth-required `GET /api/me` endpoint
- NDJSON chat streaming (`token`, `done`, `error`) with metrics (`response_ms`, `first_token_ms`, `tokens_emitted`, `status`)
- Azure Blob conversation persistence scoped by `user_id/session_id`
- Azure Blob profile touch metadata scoped by `user_id`
- Azure OpenAI routing for `gpt-5` via deployment `gpt-5-chat`
- No mock-response fallback path (provider/config issues return explicit API errors)
- Backend and frontend tests/build passing locally

## Architecture

- **Frontend:** Vite + React + TypeScript + Tailwind CSS + Clerk React SDK
- **Backend:** FastAPI mounted in Azure Functions (`AsgiFunctionApp`)
- **Auth:** Clerk JWT passed as `Authorization: Bearer <token>`
- **Providers:** Azure OpenAI GPT-5 only (`model: "gpt-5"`)
- **Storage:** Azure Blob (`neurarchat-memory`, `neurarchat-profiles`) with per-user keys

## Authentication & Data Storage

How login works:

1. Signed-out users see Clerk `SignIn` screen.
2. Clerk validates email/password and issues a session token.
3. Frontend sends token to backend on protected calls.
4. Backend verifies token signature/claims using Clerk JWKS.
5. Backend reads `sub` as `user_id` and scopes storage to that user.

Where data is stored:

- **Credentials + auth sessions:** stored in **Clerk**.
- **App chat history + profile metadata:** stored in **Azure Blob Storage** under user-specific paths.

## Blob Key Layout

- Conversation blobs: `conversations/{user_id}/{session_id}.json`
- Profile blobs: `profiles/{user_id}.json`

Containers:

- `neurarchat-memory`
- `neurarchat-profiles`

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
- Azure Storage connection (or Azurite for local Blob emulation)
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

Backend:

- Copy `NeuralChat/backend/local.settings.example.json` to `NeuralChat/backend/local.settings.json`
- Configure:
  - `AZURE_STORAGE_CONNECTION_STRING`
  - `AZURE_BLOB_MEMORY_CONTAINER`
  - `AZURE_BLOB_PROFILES_CONTAINER`
  - `CLERK_JWKS_URL`
  - `CLERK_ISSUER` (optional but recommended)
  - `CLERK_AUDIENCE` (optional if your token has audience)
  - `AZURE_OPENAI_ENDPOINT`
  - `AZURE_OPENAI_API_KEY`
  - `AZURE_OPENAI_DEPLOYMENT_NAME`
  - `AZURE_OPENAI_API_VERSION`

Frontend:

- Copy `NeuralChat/frontend/.env.example` to `NeuralChat/frontend/.env`
- Configure:
  - `VITE_CLERK_PUBLISHABLE_KEY`
  - `VITE_API_BASE_URL` (default `http://localhost:7071` for Functions runtime)

## API Summary

- `GET /api/health` (public)
  - Returns: `{"status":"ok","timestamp":"...","version":"..."}`

- `GET /api/me` (auth required)
  - Header: `Authorization: Bearer <clerk_jwt>`
  - Returns: `{"user_id":"...","status":"ok"}`

- `POST /api/chat` (auth required)
  - Header: `Authorization: Bearer <clerk_jwt>`
  - Request: `{"session_id","message","model":"gpt-5","stream"}`
  - Stream chunks:
    - `{"type":"token","content":"..."}`
    - `{"type":"done","request_id","response_ms","first_token_ms","tokens_emitted","status"}`
    - `{"type":"error","content":"...","request_id":"..."}`

## Verification

Current local checks:

- Backend: `source .venv/bin/activate && python -m unittest discover -s tests -v`
- Frontend tests: `npm run test -- --run`
- Frontend build: `npm run build`

## Security Notes

- Never commit real credentials to tracked files.
- Keep real keys only in local/private config or cloud secret stores.
- Rotate leaked keys immediately if they ever appear in history.

## Internal Docs

- Architecture details: [`NeuralChat/docs/ARCHITECTURE.md`](./NeuralChat/docs/ARCHITECTURE.md)
- Task roadmap: [`NeuralChat/docs/ROADMAP.md`](./NeuralChat/docs/ROADMAP.md)
- Learning log template: [`NeuralChat/journal/BUG_JOURNAL.md`](./NeuralChat/journal/BUG_JOURNAL.md)
