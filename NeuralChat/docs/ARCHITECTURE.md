# NeuralChat Architecture

NeuralChat is split into a Vite frontend and a FastAPI backend mounted through Azure Functions. The system is organized around authenticated chat sessions, user-level memory, optional external retrieval, and session-scoped file and agent artifacts stored in Azure Blob Storage.

## Runtime Components

### Frontend

- React + TypeScript + Tailwind CSS
- Clerk React for auth shell and token retrieval
- Local conversation state in browser storage
- Streaming NDJSON handling for chat and agent execution
- Sidebar controls for `Web search` and `Agent mode`
- In-thread rendering for normal assistant replies and agent progress blocks

### Backend

- FastAPI app in `backend/app/main.py`
- Azure Functions ASGI entry point in `backend/function_app.py`
- Service modules for:
  - chat orchestration
  - memory
  - search
  - file handling
  - title generation
  - storage
  - agent planning and execution

### External services

- Clerk for auth and identity
- Azure OpenAI GPT-5 for chat, title refinement, memory extraction, and agent planning/summarization
- Tavily for external web search
- Azure Blob Storage for app persistence

## Identity and Naming Model

### Stable identity

Authorization and ownership always depend on:

- `user_id` from the Clerk JWT `sub` claim
- `session_id` from the app request payload or query string

### Readable naming

Protected frontend requests may include:

- `X-User-Display-Name`
- `X-Session-Title`

The backend uses these only to make Blob paths readable in Azure. Stable ids stay embedded in every canonical path segment.

Examples:

- user segment:
  - `abdul-hanan__user_abc123`
- session segment:
  - `rag-based-chatbot-architecture__session_xyz789`

### Lazy migration

Older id-only blob names are still readable. On later reads or writes, the backend migrates them to the readable canonical path.

## Storage Containers and Paths

### `neurarchat-memory`

- conversations:
  - `conversations/{display_name__user_id}/{session_title__session_id}.json`
- search cache:
  - `search-cache/{sha256(normalized_query)}.json`

### `neurarchat-profiles`

- profile facts:
  - `profiles/{display_name__user_id}.json`

### `neurarchat-uploads`

- raw files:
  - `{display_name__user_id}/{session_title__session_id}/{filename}`

### `neurarchat-parsed`

- parsed chunks:
  - `{display_name__user_id}/{session_title__session_id}/{filename}.json`

### `neurarchat-agents`

- plan JSON:
  - `{display_name__user_id}/{session_title__session_id}/plans/{plan_id}.json`
- execution log JSON:
  - `{display_name__user_id}/{session_title__session_id}/logs/{plan_id}.json`

## Auth Flow

1. User signs in through Clerk on the frontend.
2. Frontend obtains a session token.
3. Protected requests send `Authorization: Bearer <token>`.
4. Backend verifies the token using Clerk JWKS.
5. Backend derives `user_id` and scopes all data access to that user.
6. Optional readable naming headers are applied only to Blob path naming.

## Chat Flow

### Request

`POST /api/chat`

Validated payload:

- `session_id`
- `message`
- `model` where the only allowed value is `gpt-5`
- `stream`
- optional `force_search`

### Pipeline

1. Save the user message into the conversation blob.
2. Build a memory prompt from the stored profile.
3. If search is forced or selected by backend logic, resolve cached or live Tavily results.
4. Load uploaded files for the current user and session.
5. Load parsed chunks and rank relevant chunks for the current message.
6. Compose the final prompt context from:
   - memory
   - search context
   - file context
   - base instructions
7. Generate the assistant reply through Azure OpenAI.
8. Stream NDJSON tokens back to the frontend.
9. Save the assistant message and metadata.
10. Trigger asynchronous memory extraction for the exchange.

### Chat stream contract

Chunk types:

- `token`
- `done`
- `error`

The final `done` payload can include:

- `request_id`
- `response_ms`
- `first_token_ms`
- `tokens_emitted`
- `status`
- `search_used`
- `file_context_used`
- `sources`

## Memory Flow

### Stored profile fields

The backend extracts compact user facts into profile JSON, including fields such as:

- `name`
- `job`
- `city`
- `preferences`
- `goals`

### Memory usage

- `GET /api/me` returns the current profile
- `PATCH /api/me/memory` updates one memory key or merges new facts
- `DELETE /api/me/memory` clears the whole profile
- `build_memory_prompt()` injects profile facts into later chat prompts

Profile memory is user-level, not session-level.

## Web Search Flow

1. Frontend toggles `Web search` from the sidebar.
2. Chat request includes `force_search: true` when the user explicitly wants web results.
3. Backend checks cache first.
4. If not cached, backend calls Tavily and stores normalized results in Blob.
5. Search context is appended to the system prompt.
6. Assistant reply metadata marks `search_used` and includes `sources`.

## File Upload and Retrieval Flow

### Upload path

`POST /api/upload`

Form fields:

- `session_id`
- `file`

### Pipeline

1. Validate extension and 25 MB size limit.
2. Save the raw file into `neurarchat-uploads`.
3. Check whether parsed chunks already exist.
4. If not, parse and chunk the file.
5. Save parsed chunk JSON into `neurarchat-parsed`.
6. Return filename, blob path, chunk count, and success message.

### Retrieval path

- `GET /api/files?session_id=...`
- `DELETE /api/files/{filename}?session_id=...`

Parsed chunks are reused across later prompts in the same chat session.

## Hybrid Conversation Title Flow

NeuralChat uses a two-stage title strategy.

### Stage 1: immediate local title

The frontend creates a short local title from the first prompt so the sidebar updates instantly.

### Stage 2: backend refinement

After the first useful reply or first useful agent result, the frontend may call:

- `POST /api/conversations/title`

The backend returns a concise 3 to 6 word summary title. If refinement fails, the local title remains in place.

This same title is then reused as the readable session label sent in `X-Session-Title`.

## Agent Mode Flow

### Planning

`POST /api/agent/plan`

Validated payload:

- `goal`
- `session_id`

Pipeline:

1. Backend asks GPT-5 for a step-by-step JSON plan.
2. Plan is normalized and capped at 6 steps.
3. If the planner returns no valid steps, a fallback reasoning step is injected.
4. Plan is saved to Blob.
5. Frontend renders the plan inside the chat thread.

### Execution

`POST /api/agent/run/{plan_id}`

Validated payload:

- `session_id`

Execution uses LangGraph as a sequential state machine over the stored plan.

Supported tools:

- `web_search`
- `read_file`
- `memory_recall`
- reasoning-only step with no tool

Safety rules:

- max 6 steps per plan
- repeated identical tool calls trigger a loop warning and stop execution
- failed steps are recorded and execution continues
- total execution timeout is 60 seconds

### Agent stream contract

Chunk types:

- `plan`
- `step_start`
- `step_done`
- `warning`
- `summary`
- `done`
- `error`

### Agent history

- `GET /api/agent/history`
- `GET /api/agent/history/{plan_id}`

History is user-scoped. It is not filtered by session at the API layer.

## Delete Chat Flow

`DELETE /api/conversations/{session_id}` performs real backend cleanup for the authenticated user.

It deletes:

- the conversation blob
- raw uploaded files for that session
- parsed file chunk blobs for that session
- agent plans for that session
- agent execution logs for that session

It does not delete:

- the user profile memory blob

That separation is intentional because profile memory is account-scoped while chats are session-scoped.
