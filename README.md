# NeuralChat

[![Status](https://img.shields.io/badge/status-active%20development-0a7ea4)](#project-status)
[![Frontend](https://img.shields.io/badge/frontend-React%20%2B%20Tailwind-38bdf8)](#architecture)
[![Backend](https://img.shields.io/badge/backend-FastAPI%20on%20Azure%20Functions-2563eb)](#architecture)
[![Auth](https://img.shields.io/badge/auth-Clerk-6d28d9)](#authentication--data-storage)
[![Storage](https://img.shields.io/badge/storage-Azure%20Blob-0ea5e9)](#authentication--data-storage)
[![Web Search](https://img.shields.io/badge/search-Tavily-16a34a)](#web-search)
[![Python](https://img.shields.io/badge/python-3.13-3776ab)](#prerequisites)
[![Node](https://img.shields.io/badge/node-24.x-339933)](#prerequisites)

NeuralChat is a beginner-first AI workspace with secure login, streaming responses, user-scoped cloud memory, optional web search with citations, file/PDF upload Q&A, and plan-first agent execution.

This repository is organized as a workspace root with implementation inside [`NeuralChat/`](./NeuralChat).

---

## Project Status

As of **March 16, 2026**, the following are implemented and working:

- Clerk login/logout frontend shell (signed-in and signed-out views)
- Backend JWT verification for Clerk bearer tokens via JWKS
- Public `GET /api/health` and `GET /api/search/status`
- Auth-required `POST /api/chat`, `GET /api/me`, `PATCH /api/me/memory`, `DELETE /api/me/memory`, `DELETE /api/conversations/{session_id}`
- Auth-required file APIs: `POST /api/upload`, `GET /api/files`, `DELETE /api/files/{filename}`
- NDJSON streaming (`token`, `done`, `error`) with metrics (`response_ms`, `first_token_ms`, `tokens_emitted`, `status`)
- Azure Blob conversation persistence scoped by stable `user_id/session_id` and cleaned up by backend when a chat is deleted
- Deep Memory profile facts extraction + prompt injection for chat
- Tavily web search integration with 24-hour Blob cache (`search-cache/{sha256(query)}.json`)
- Frontend web-search UX: sidebar control, per-message search badge, expandable source citations
- Azure OpenAI GPT-5 path only (`model: "gpt-5"`, deployment example `gpt-5-chat`)
- File upload pipeline (raw + parsed chunks in Blob) with session-scoped retrieval
- Chat file-context injection and file context badge when file context is used
- Agent Mode with LangChain + LangGraph:
  - `POST /api/agent/plan`
  - `POST /api/agent/run/{plan_id}`
  - `GET /api/agent/history?session_id=` ← now session-scoped
  - `GET /api/agent/history/{plan_id}`
- Agent plan preview, explicit `Run plan`, streamed step execution, and final summary
- Agent plan/log persistence in Blob, scoped to `user_id + session_id`
- Deployed Azure Function backend smoke-tested successfully for auth, chat, search, file upload/list/delete, and file-context chat
- **Complete UI/UX redesign** — purple accent theme, dark/light mode, world-class component library

---

## What Changed in This Session (March 16, 2026)

### Frontend — UI/UX Redesign

**Theme & Design System (`index.css`)**
- Full CSS variable system: dark mode (`#0f0f0e` bg) and light mode (`#f7f8fc` bg) with proper `data-theme` switching
- Purple accent color `#7F77DD` / `#6C63D4` replacing orange throughout
- Frosted glass topbar with `backdrop-filter: blur(16px)`
- All hardcoded dark `rgba(255,255,255,X)` values replaced with CSS variables for proper light/dark adaptation

**Topbar**
- Height 56px, glass backdrop
- Button hierarchy: Agents (purple-tinted icon+label) → Share (pill) → Model selector → Debug (muted) → Notification bell
- Vertical divider between title and actions via `::before` pseudo-element

**Notification Bell**
- Bell button in topbar with red badge count
- Dropdown panel with header, "Clear all", notification list with tone dots (green/red/purple glow)
- Floating toasts removed — all notifications route to the bell panel
- Bell shakes via CSS `:has(.nc-notif-badge)` animation

**Sidebar User Profile Card**
- Purple glass hover effect
- Avatar ring + green online status dot `::after`
- `⋯` 3-dot button (always visible, 32×32px) replacing gear icon
- Avatar scales 4% on hover with purple double-ring halo

**Message Bubbles (`MessageBubble.tsx`)**
- `remark-math` + `rehype-katex` for rendered LaTeX math (block + inline)
- `normalizeMath()` preprocessor converts GPT's `\[...\]`, `\(...\)`, bare `[` `]` blocks → `$$` / `$`
- `remarkGfm` for GitHub-Flavored Markdown tables
- Assistant label badges: **Agent** (amber), **Web search** (purple), **File context** (green)
- File attachment chips hidden from message bubbles — visible in file manager only
- `CodeBlockProps` and `MessageBubbleProps` interfaces restored

**Agent Progress (`AgentProgress.tsx`)**
- Complete timeline redesign: status orb, progress bar track, vertical connector line
- Step dots change icon by state (✓/✗/pulse/number)
- Tool badges (🔍 Web search, 📄 File, 🧠 Memory)
- Chevron expand with rotation animation
- Summary section with thinking dots animation
- `remarkGfm` + `remarkMath` + `rehypeKatex` added to `MarkdownContent`
- Full table components with CSS variable styling (no hardcoded dark colors)
- Duplicate `table`/`th`/`td` keys removed

**Agent History (`AgentHistory.tsx`)**
- Full panel redesign: slide-in animation, frosted backdrop
- Header with robot icon, task count subtitle
- Shimmer loading skeletons
- Task cards: numbered badge, 2-line clamped goal, step count, status pill
- Expandable step rows with status dots and result/error detail
- Module-level cache (`_historyCache`) — instant display on reopen, silent background refresh
- Fresh Clerk token fetched on each task expand (fixes stale token 401)
- **Session-scoped**: only shows tasks for the currently open chat

**File Upload (`FileUpload.tsx` + `FileList.tsx`)**
- Modal was invisible — entire `nc-file-upload-modal` CSS block was missing, now added
- Dropzone with upload arrow icon, drag-active states, spring entrance animation
- Gradient progress bar, styled error/success messages
- `FileList`: emoji file type icons, chunk count + size info, hover-reveal delete button
- File chips hidden from user message bubbles

**Topbar Notification Panel**
- Bottom-center frosted glass pill toasts replaced by bell panel
- All notifications persist until manually dismissed

### Backend — Agent & Planner Fixes (`agent.py`, `main.py`)

**Session-scoped Agent History**
- `GET /api/agent/history` now accepts optional `?session_id=` query param
- `list_task_plans(user_id, session_id=None)` filters blob results by `plan.session_id`
- `session_id` added to response payload per task
- Frontend `getAgentHistory(authToken, sessionId, naming)` passes current session ID

**Planner Hallucination Fix**
- Planner prompt updated: "Never invent or assume a filename — if no file was uploaded, do NOT use `read_file`"
- `read_file` tool now falls back to `_run_reasoning_step` on `ValueError` (file not found) instead of marking step failed
- Steps that had no file gracefully complete as `done` with a reasoned answer

**LangGraph State Fixes**
- `stream_mode="updates"` partial state fixed — all nodes explicitly pass through required fields
- `started_at` guarded against `None`
- `AgentState` TypedDict added with `total=False`

### TypeScript Fixes
- `vite-env.d.ts` added to `frontend/src/` — fixes `import.meta.env` TypeScript error
- `.vscode/settings.json` — suppresses `@tailwind` unknown-at-rule CSS warnings
- `step.status` cast to `"done" | "running" | "failed" | "pending"` union in `AgentProgress`
- `fileItem` explicitly typed to fix implicit `any`

---

## Architecture

- **Frontend:** Vite + React + TypeScript + Tailwind CSS + Clerk React SDK
- **Backend:** FastAPI mounted in Azure Functions (`AsgiFunctionApp`)
- **Auth:** Clerk JWT (`Authorization: Bearer <token>`)
- **Providers:** Azure OpenAI GPT-5 only
- **Storage:** Azure Blob
  - `neurarchat-memory` (conversations + search cache)
  - `neurarchat-profiles` (user profile facts)
  - `neurarchat-uploads` (raw uploaded files)
  - `neurarchat-parsed` (parsed chunk JSON)
  - `neurarchat-agents` (agent plans + execution logs, session-scoped)

---

## Deployment Status

Current hosted backend:

- `https://neural-chat-emg6cva3befyayd4.eastus-01.azurewebsites.net`

---

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
- **Uploaded files + parsed chunks:** Azure Blob

---

## Web Search

NeuralChat supports:

- **Manual Web search control** in the left sidebar under `New chat`

Behavior:

- Search results are cached for 24 hours in Blob.
- If search is used, UI shows a purple **Web search** badge and a collapsible Sources section.
- If force-search is enabled and no results are found, backend returns a clear message instead of silently falling back.

---

## File Upload Q&A Flow

When a user uploads a document:

1. Frontend calls `POST /api/upload` with multipart data (`session_id`, `file`).
2. Backend validates file type and 25MB size limit.
3. Raw file stored in session-scoped uploads container.
4. Parsed chunks reused from `neurarchat-parsed` if already available; otherwise parsed and chunked.
5. On `POST /api/chat`, backend loads session file chunks and injects top relevant chunks into GPT system prompt.
6. Response metadata includes `file_context_used`; frontend shows green **File context** badge.

Session rule: uploaded files are scoped to `user_id + session_id` — files in one chat stay in that chat only.

---

## Chat Deletion Cleanup

Deleting a chat calls `DELETE /api/conversations/{session_id}` and the backend deletes:

- conversation history for that session
- raw uploaded files for that session
- parsed file chunks for that session
- agent plans for that session
- agent execution logs for that session

User-level profile memory in `neurarchat-profiles` is intentionally not deleted.

---

## Agent Mode

Agent Mode is a separate workflow from normal chat:

1. User turns on `Agent mode` from the left sidebar.
2. User submits a goal instead of a normal prompt.
3. Backend creates a plan and returns it to the UI.
4. User explicitly clicks `Run plan`.
5. Backend streams: plan → step start → step done/failed → warning → final summary → done.
6. Plans and execution logs stored in session-scoped agents container.
7. Agent History panel shows only tasks from the currently open chat session.

Safety rules:
- Max 6 steps
- Loop detection stops repeated same-tool execution
- Failed steps are logged but do not abort the whole task
- Total execution timeout: 60 seconds
- Planner never invents filenames — `read_file` only used when user explicitly uploads a file

---

## Frontend npm Packages Required

```bash
npm install remark-math rehype-katex katex remark-gfm react-syntax-highlighter @types/react-syntax-highlighter
```

---

## Repository Layout

```text
PROJECT/
├── NeuralChat/
│   ├── backend/
│   │   └── app/
│   │       ├── services/
│   │       │   └── agent.py       ← planner + history fixes
│   │       ├── main.py            ← session-scoped agent history endpoint
│   │       └── schemas.py
│   ├── frontend/
│   │   └── src/
│   │       ├── api/
│   │       │   └── agent.ts       ← getAgentHistory passes session_id
│   │       ├── components/
│   │       │   ├── AgentHistory.tsx   ← redesigned + session-scoped
│   │       │   ├── AgentProgress.tsx  ← timeline redesign + math/table support
│   │       │   ├── FileList.tsx       ← new styled file list
│   │       │   ├── FileUpload.tsx     ← modal CSS fix + redesign
│   │       │   ├── MessageBubble.tsx  ← math rendering + badges
│   │       │   └── Sidebar.tsx        ← purple theme + 3-dot menu
│   │       ├── App.tsx            ← notification bell + file upload fix
│   │       ├── index.css          ← complete design system
│   │       ├── types.ts           ← add session_id? to AgentTaskSummary
│   │       └── vite-env.d.ts      ← new: fixes import.meta.env TS error
│   ├── docs/
│   └── journal/
└── README.md
```

---

## Prerequisites

- Python 3.13+
- Node.js 24+
- npm 11+
- Azure Storage connection (or Azurite)
- Azure Functions Core Tools v4 (optional runtime path)

---

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

---

## Configuration

Backend (`NeuralChat/backend/local.settings.json`):

- `AZURE_STORAGE_CONNECTION_STRING`
- `AZURE_BLOB_MEMORY_CONTAINER`
- `AZURE_BLOB_PROFILES_CONTAINER`
- `AZURE_BLOB_UPLOADS_CONTAINER`
- `AZURE_BLOB_PARSED_CONTAINER`
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
- `VITE_API_BASE_URL` (e.g. `https://neural-chat-emg6cva3befyayd4.eastus-01.azurewebsites.net`)

---

## API Summary

- `GET /api/health` (public) → `{"status":"ok","timestamp":"...","version":"..."}`
- `GET /api/search/status` (public) → `{"search_enabled": true|false}`
- `GET /api/me` (auth) → `{"user_id":"...","profile":{...}}`
- `PATCH /api/me/memory` (auth) → `{"key":"city","value":"Lahore"}`
- `DELETE /api/me/memory` (auth) → `{"message":"Memory cleared"}`
- `POST /api/chat` (auth, NDJSON stream)
- `POST /api/upload` (auth, multipart) → `{"filename","blob_path","chunk_count","message"}`
- `GET /api/files?session_id=` (auth) → `{"files":[...]}`
- `DELETE /api/files/{filename}?session_id=` (auth) → `{"message":"..."}`
- `DELETE /api/conversations/{session_id}` (auth)
- `POST /api/agent/plan` (auth) → `{"plan":{...}}`
- `POST /api/agent/run/{plan_id}` (auth, NDJSON stream)
- `GET /api/agent/history?session_id=` (auth) → `{"tasks":[...]}` ← session-scoped
- `GET /api/agent/history/{plan_id}` (auth) → `{"plan":{...},"log":[...]}`

---

## types.ts Change Required

Add `session_id` to `AgentTaskSummary`:

```ts
export interface AgentTaskSummary {
  plan_id: string;
  goal: string;
  created_at: string;
  steps_count: number;
  session_id?: string; // added — returned by backend for session filtering
}
```

---

## Verification

- Backend: `cd backend && .venv/bin/pytest -q tests`
- Frontend tests: `cd frontend && npm run test -- --run`
- Frontend build: `cd frontend && npm run build`

---

## Security Notes

- Never commit real credentials to tracked files.
- Keep production keys in secret stores.
- Rotate keys immediately if exposed.
- Treat pasted Clerk bearer tokens as compromised after any external sharing.
- Prefer Clerk JWT templates for smoke testing.

---

## Internal Docs

- Architecture details: [`NeuralChat/docs/ARCHITECTURE.md`](./NeuralChat/docs/ARCHITECTURE.md)
- Task roadmap: [`NeuralChat/docs/ROADMAP.md`](./NeuralChat/docs/ROADMAP.md)
- Deployment checklist: [`NeuralChat/docs/DEPLOYMENT.md`](./NeuralChat/docs/DEPLOYMENT.md)
- Learning log template: [`NeuralChat/journal/BUG_JOURNAL.md`](./NeuralChat/journal/BUG_JOURNAL.md)