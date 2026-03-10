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
- `CLAUDE_API_KEY`
- `OPENAI_API_KEY`
- optional: `MOCK_STREAM_DELAY_MS`

## Grip Workflow
For every task: `Goal -> What you type -> Why it works -> Break test -> Own rewrite`.
