# NeuralChat Roadmap

This roadmap reflects the current shipped state and the next practical improvements based on the codebase as it exists now.

## Shipped Foundations

### Core app

- GPT-5 chat through Azure OpenAI
- NDJSON streaming responses
- React + TypeScript frontend shell
- Azure Functions-hosted FastAPI backend
- Browser-routed workspace views

### Auth and persistence

- Clerk authentication
- JWT verification in backend
- Azure Blob persistence across chats, memory, files, agents, projects, and usage
- readable blob naming with stable ids
- real backend chat deletion

### Deep memory

- global profile memory extraction
- prompt injection from stored memory
- memory read / update / clear APIs

### Web search

- Tavily integration
- Blob-backed search cache
- sidebar `Web search` control
- source metadata returned with answers

### File retrieval

- upload validation and persistence
- parsed chunk caching and reuse
- file-context injection into prompts
- normal session files and project files both supported

### Agent Mode

- plan-first workflow
- explicit run step
- streamed progress and summary
- stored plan and log history
- step cap, loop guard, and timeout rules

### Cost monitoring

- per-user usage logging for GPT calls
- daily usage JSON in Blob
- usage summary APIs
- editable daily budget limit
- settings dashboard and chat warning banner

### Projects

- project templates
- project CRUD
- project-scoped chats
- Project Brain memory and background learning
- Project Brain completeness, reset, and recent-learning log
- project-scoped files
- routed projects page and project workspace
- sidebar project sub-items

## Next Recommended Work

### 1. Project workspace polish

- richer project chat cards and project overview surfaces
- stronger project file actions and previews
- inline rename / metadata editing in the workspace header
- better project-specific empty states and onboarding hints

### 2. Retrieval quality upgrade

- move from keyword-heavy chunk selection toward embeddings-based ranking
- preserve a simple fallback path for resilience
- expose better retrieval debugging in the UI

### 3. Richer citations and attribution

- file chunk attribution in responses
- clearer source provenance for mixed search + file answers
- better renderers for citations in chat and projects

### 4. Image and multimodal understanding

- OCR or multimodal extraction for image uploads
- distinct treatment for image-derived context versus text-derived context
- preserve current document parsing path as fallback

### 5. Performance and bundle shaping

- split the large frontend bundle
- lazy-load heavy route surfaces such as project pages and settings charts
- reduce duplicated vendor cost in the browser

### 6. Deployment hardening

- more repeatable release process
- tighter secret handling and validation
- improved smoke-test automation for hosted backend changes

## Guiding Principles

Near-term roadmap work should keep these boundaries intact:
- user-level memory stays separate from project memory
- global chat stays separate from project chat
- normal chat stays separate from Agent Mode
- cost visibility remains available without cluttering core navigation
- new polish should not weaken the current backend cleanup and storage guarantees
