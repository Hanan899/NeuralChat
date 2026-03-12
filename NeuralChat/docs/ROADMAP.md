# NeuralChat Roadmap (Beginner-Friendly)

## Completed Milestones

### Phase 1: Foundation
- Streaming chat UI and backend
- `GET /api/health` and `POST /api/chat`
- GPT-5 Azure OpenAI integration

### Phase 2: Auth + Cloud Persistence
- Clerk login/logout
- JWT verification on backend
- User-scoped conversation storage in Blob

### Phase 3: Deep Memory
- Profile extraction from chat exchanges
- Prompt injection from profile memory
- `/api/me` and memory CRUD endpoints

### Phase 4: Web Search
- Tavily integration with 24h Blob cache
- Force-search toggle in frontend
- Sources returned and rendered with `🌐` badge

### Phase 5: File & PDF Upload (Task 9)
- Upload endpoint with 25MB/type validation
- Raw file storage in `neurarchat-uploads`
- Parsed chunk storage in `neurarchat-parsed`
- Session-scoped file listing and delete
- File context injection into chat prompt
- `📄` badge when answer used uploaded file context

## What To Build Next

### Task 10: Retrieval Quality Upgrade
- Replace keyword chunk scoring with embeddings + cosine similarity
- Keep chunk fallback path for safety
- Add relevance debug output in diagnostics panel

### Task 11: Source Attribution for Files
- Track which filename produced each chunk
- Return file citations with chunk snippets in done metadata
- Show per-file citations in assistant message UI

### Task 12: Image Understanding Path
- Add OCR/vision extraction for PNG/JPG uploads
- Keep existing text parser for docs/txt/csv
- Add clear UI indicator when image context is used

### Task 13: Deployment Hardening
- Move secrets to managed secret storage and rotate exposed values
- Add release checklist for Azure Function settings and CORS
- Add browser-level smoke test automation for hosted backend

## Daily Learning Loop (45-60 minutes)

1. Goal
2. What you type
3. Why it works
4. Break test
5. Own rewrite

## Weekly Habit

- Pick one feature file and rebuild it from memory.
- Add one bug-journal entry with:
  - bug
  - root cause
  - fix
  - prevention rule
