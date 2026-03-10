# NeuralChat

Beginner-first AI chat project using React + Tailwind frontend and Azure Functions (Python) backend.

## Folder Structure
- `frontend/` React app (UI + streaming parser + debug panel)
- `backend/` Azure Functions + FastAPI APIs (`/api/health`, `/api/chat`)
- `docs/` architecture and beginner roadmap
- `journal/` bug journal template

## Backend Quick Start
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## Frontend Quick Start (requires Node.js)
```bash
cd frontend
npm install
npm run dev
```

## Environment Variables
Create `backend/local.settings.json` from `backend/local.settings.example.json` and set:
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_DEPLOYMENT_NAME`
- `AZURE_OPENAI_API_VERSION` (default: `2025-01-01-preview`)
- `CLAUDE_API_KEY`
- `OPENAI_API_KEY`
- optional: `MOCK_STREAM_DELAY_MS`

Notes:
- `uvicorn app.main:app --reload` now auto-loads `backend/local.settings.json` for local development.
- If `AZURE_OPENAI_*` vars are present, `model: "gpt4o"` requests use Azure Chat Completions first (deployment can be `gpt-5-chat`).
- Never commit real API keys to `local.settings.example.json` or any tracked file.

## Grip Workflow
For every task: `Goal -> What you type -> Why it works -> Break test -> Own rewrite`.
