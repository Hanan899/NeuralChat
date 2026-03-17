# NeuralChat Workspace

NeuralChat is a personal AI chat workspace built inside the `NeuralChat/` app directory. The current project ships authenticated GPT-5 chat, deep memory, optional Tavily-backed web search, session-scoped file upload and retrieval, and plan-first Agent Mode.

## Workspace Layout

This repository root is a workspace wrapper around the actual app:

```text
PROJECT/
├── NeuralChat/
│   ├── backend/   # FastAPI app mounted in Azure Functions
│   ├── frontend/  # Vite + React + TypeScript client
│   └── docs/      # Architecture, deployment, and roadmap docs
├── README.md
└── package-lock.json
```

Project-maintained docs live in:

- [NeuralChat/README.md](/Users/hanan/Documents/PROJECT/NeuralChat/README.md)
- [NeuralChat/docs/ARCHITECTURE.md](/Users/hanan/Documents/PROJECT/NeuralChat/docs/ARCHITECTURE.md)
- [NeuralChat/docs/DEPLOYMENT.md](/Users/hanan/Documents/PROJECT/NeuralChat/docs/DEPLOYMENT.md)
- [NeuralChat/docs/ROADMAP.md](/Users/hanan/Documents/PROJECT/NeuralChat/docs/ROADMAP.md)

Generated and vendor folders are intentionally not documented in detail here, including:

- `backend/.venv`
- `frontend/node_modules`
- `frontend/dist`
- `backend/__blobstorage__`
- `backend/__queuestorage__`
- cache and test artifact directories

## Current Stack

- Frontend: Vite, React, TypeScript, Tailwind CSS, Clerk React
- Backend: FastAPI behind Azure Functions ASGI
- Model provider: Azure OpenAI GPT-5
- Search: Tavily with Blob-backed caching
- Agent orchestration: LangChain + LangGraph
- Storage: Azure Blob Storage
- Auth: Clerk JWT verification through JWKS

## What Is Implemented Now

- Clerk sign-in and protected frontend shell
- Authenticated chat with NDJSON streaming
- User-level deep memory with profile extraction and prompt injection
- Optional web search controlled from the sidebar
- Session-scoped file upload, parsed chunk reuse, and file-grounded answers
- Hybrid conversation titles: local summary first, backend refinement after first response
- Agent Mode with plan preview, explicit run, streamed steps, and stored history
- Real backend chat deletion that removes session-scoped conversation, file, and agent artifacts
- Readable Azure Blob naming using readable labels plus stable ids

## Where To Start

- Product and developer overview: [NeuralChat/README.md](/Users/hanan/Documents/PROJECT/NeuralChat/README.md)
- Runtime/data flow: [NeuralChat/docs/ARCHITECTURE.md](/Users/hanan/Documents/PROJECT/NeuralChat/docs/ARCHITECTURE.md)
- Local setup and Azure deployment: [NeuralChat/docs/DEPLOYMENT.md](/Users/hanan/Documents/PROJECT/NeuralChat/docs/DEPLOYMENT.md)
- Completed work and next milestones: [NeuralChat/docs/ROADMAP.md](/Users/hanan/Documents/PROJECT/NeuralChat/docs/ROADMAP.md)
