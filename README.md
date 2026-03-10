# NeuralChat

[![Status](https://img.shields.io/badge/status-active%20development-0a7ea4)](#project-status)
[![Frontend](https://img.shields.io/badge/frontend-React%20%2B%20Tailwind-38bdf8)](#architecture)
[![Backend](https://img.shields.io/badge/backend-FastAPI%20on%20Azure%20Functions-2563eb)](#architecture)
[![Python](https://img.shields.io/badge/python-3.13-3776ab)](#prerequisites)
[![Node](https://img.shields.io/badge/node-24.x-339933)](#prerequisites)

NeuralChat is a personal AI assistant platform focused on fast streaming chat, model routing, local-first development, and production-ready Azure integration.

This repository is organized as a project root with the implementation inside [`NeuralChat/`](./NeuralChat).

## Project Status

As of **March 10, 2026**, the following are implemented and working:

- React frontend with chat UI, model selector, streaming token rendering, and debug panel
- Python backend (FastAPI) hosted through Azure Functions entrypoint
- `GET /api/health` and `POST /api/chat` endpoints
- NDJSON streaming with completion metadata (`done`, `response_ms`, `first_token_ms`, `tokens_emitted`, `status`)
- Interruption-safe streaming (partial response persistence with `status: interrupted`)
- Local conversation persistence in JSON by `session_id`
- CORS preflight support for browser clients
- Azure OpenAI routing for `gpt4o` requests when `AZURE_OPENAI_*` variables are configured
- Local environment autoload from `backend/local.settings.json` during `uvicorn` runs
- Backend and frontend test/build pipeline passing locally

## Architecture

- **Frontend:** Vite + React + TypeScript + Tailwind CSS
- **Backend:** FastAPI + Azure Functions adapter (`AsgiFunctionApp`)
- **Providers:** Claude, OpenAI fallback, Azure OpenAI primary path for `gpt4o`
- **Storage:** Local JSON conversation files (Azure Blob integration planned next phases)

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
- (Optional for Azure Functions local runtime) Azure Functions Core Tools v4

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

Copy and update:

- `NeuralChat/backend/local.settings.example.json` -> `NeuralChat/backend/local.settings.json`

Recommended keys:

- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_DEPLOYMENT_NAME`
- `AZURE_OPENAI_API_VERSION`
- `MOCK_STREAM_DELAY_MS` (optional)

If `AZURE_OPENAI_*` values are present, `model: "gpt4o"` uses Azure Chat Completions.

## API Summary

- `GET /api/health`
  - Returns: `{"status":"ok","timestamp":"...","version":"..."}`

- `POST /api/chat`
  - Request: `{"session_id","message","model","stream"}`
  - Stream chunks:
    - `{"type":"token","content":"..."}`
    - `{"type":"done","request_id","response_ms","first_token_ms","tokens_emitted","status"}`

## Quality & Verification

Current local checks passing:

- Backend: `python -m unittest discover -s tests -v`
- Frontend tests: `npm run test`
- Frontend build: `npm run build`

## Security Notes

- Never commit real secrets to tracked files.
- Keep real credentials only in local/private config (`local.settings.json`, `.env`, secret stores).
- Rotate any key immediately if exposed in Git history.

## Roadmap (Next)

- Azure Blob persistence migration
- Memory viewer/edit panel
- File upload and document context
- Agent mode and tool orchestration (MCP-aligned)
- Deployment pipeline hardening and release docs

## Internal Docs

- Architecture details: [`NeuralChat/docs/ARCHITECTURE.md`](./NeuralChat/docs/ARCHITECTURE.md)
- Task roadmap: [`NeuralChat/docs/ROADMAP.md`](./NeuralChat/docs/ROADMAP.md)
- Learning log template: [`NeuralChat/journal/BUG_JOURNAL.md`](./NeuralChat/journal/BUG_JOURNAL.md)
