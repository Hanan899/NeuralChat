# NeuralChat Beginner Roadmap (45-60 min/day)

## Session Format (use every day)

- Goal
- What you type
- Why it works
- Break test
- Own rewrite

## Completed Foundation

- Chat shell + streaming UI
- `/api/health` and `/api/chat`
- Provider routing for Claude/GPT path
- Stream metrics + interruption handling

## Completed Auth + Cloud Memory Phase

- Clerk login/logout integrated in frontend
- Backend bearer token verification through Clerk JWKS
- `/api/chat` protected with `401` on missing/invalid token
- User-scoped Blob storage for conversations and profile metadata
- Session id strategy scoped per authenticated user

## Next Learning Sprint

### Day 1 — Auth Trace (Frontend to Backend)

- Goal: trace one full protected request.
- What you type: login, send one message, inspect request headers in browser devtools.
- Why it works: verifies token handoff and backend authorization path.
- Break test: remove `Authorization` header from API call and confirm backend `401`.
- Own rewrite: re-implement token injection in `api.ts` from memory.

### Day 2 — Blob Object Inspection

- Goal: understand how one chat is persisted.
- What you type: send messages in one session and inspect resulting blob JSON.
- Why it works: links runtime behavior to concrete stored state.
- Break test: change `session_id` and verify a second blob is created.
- Own rewrite: explain blob key format without looking.

### Day 3 — `/api/me` and User Context

- Goal: add and test a simple user metadata read path.
- What you type: call `/api/me` after login and display user id in UI.
- Why it works: confirms auth identity extraction independent of chat.
- Break test: call `/api/me` signed out and confirm blocked request.
- Own rewrite: re-create `require_user_id` dependency flow.

### Day 4 — Provider Visibility

- Goal: make model/provider choice transparent.
- What you type: add debug field showing selected model + active provider source.
- Why it works: improves observability and reduces confusion during testing.
- Break test: remove Azure config and confirm fallback path.
- Own rewrite: summarize routing order for `gpt4o`.

### Day 5 — Error UX Hardening

- Goal: improve user-facing auth/network/storage errors.
- What you type: map backend error cases to actionable UI messages.
- Why it works: beginner-friendly feedback speeds debugging.
- Break test: force network drop and verify interrupted stream handling.
- Own rewrite: write error mapping function from scratch.

### Day 6 — Minimal Profile Preferences

- Goal: store one user preference in `neurarchat-profiles`.
- What you type: preference API + frontend toggle (e.g., default model).
- Why it works: practices read/write with user-scoped profile data.
- Break test: confirm preference does not leak across users.
- Own rewrite: rebuild save/load preference logic from memory.

### Day 7 — Deletion Test + Journal

- Goal: lock in understanding.
- What you type: delete one small module and rebuild from memory.
- Why it works: active recall reveals real comprehension.
- Break test: compare rebuilt version with tests.
- Own rewrite: log mistakes and corrected mental model in bug journal.
