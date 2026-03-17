# NeuralChat Roadmap

This roadmap reflects the current shipped project state and the next sensible improvements based on the existing codebase.

## Completed Foundations

### Core chat

- GPT-5 chat through Azure OpenAI
- NDJSON streaming responses
- Azure Functions-hosted FastAPI backend
- Vite + React + TypeScript frontend shell

### Auth and persistence

- Clerk authentication
- JWT verification in the backend
- Azure Blob persistence for chats and profile data
- Readable Blob naming with stable ids
- Real backend chat deletion for session-scoped cleanup

### Deep Memory

- user profile extraction from chat exchanges
- prompt injection from saved memory
- memory read, update, and clear endpoints

### Web search

- Tavily integration
- Blob-backed search cache
- sidebar `Web search` control
- source metadata returned with chat responses

### File retrieval

- upload validation and Blob persistence
- parsed chunk storage and reuse
- session-scoped file listing and delete
- file-context injection into chat answers

### Agent Mode

- LangChain + LangGraph orchestration
- plan-first UX
- explicit run step
- streamed progress and final summary
- stored plan and execution log history
- loop guard, step cap, and timeout safety rules

### Conversation naming

- local summary title generation in the frontend
- backend title refinement endpoint
- readable session naming reused in Blob storage

## Next Recommended Work

### 1. Retrieval quality upgrade

- replace keyword-only chunk selection with embeddings-based ranking
- keep a simple fallback path for resilience
- expose better retrieval debug information in the UI

### 2. Stronger file attribution

- track exactly which file and chunk were used in each answer
- return file citations in response metadata
- render file citations in assistant responses

### 3. Better image understanding

- add OCR or multimodal extraction for image uploads
- distinguish image-derived context from text-derived context
- keep existing document parsing path intact

### 4. Deployment hardening

- move secrets fully into managed secret storage
- add repeatable release and smoke-test checklists
- tighten CORS and environment validation guidance

### 5. Product polish

- manual chat title rename
- richer conversation sharing flow
- more complete agent-history filtering and organization
- reduce frontend bundle size through code splitting

## Guiding Principle

Near-term roadmap work should improve reliability, retrieval quality, and product polish without breaking the current separation between:

- user-level memory
- session-level chat/file/agent artifacts
- normal chat mode
- Agent Mode
