# NeuralChat Beginner Roadmap (45-60 min/day)

## Session Format (use every day)
- Goal
- What you type
- Why it works
- Break test
- Own rewrite

## Week 1: Foundation Milestone

### Day 1 — Project Setup
- Goal: understand folder structure and app boundaries.
- What you type: create folders and read each starter file.
- Why it works: clear boundaries reduce confusion.
- Break test: rename one folder import path and watch startup fail.
- Own rewrite: recreate folder tree from memory.

### Day 2 — Health API
- Goal: first backend endpoint online.
- What you type: `GET /api/health` and response model.
- Why it works: health checks confirm server wiring.
- Break test: return wrong schema and observe validation mismatch.
- Own rewrite: rebuild endpoint without looking.

### Day 3 — Chat API Shape
- Goal: input validation and model enum.
- What you type: `ChatRequest` model and `/api/chat` route.
- Why it works: strict contracts prevent broken client calls.
- Break test: send invalid `model` value and inspect 422 error.
- Own rewrite: rebuild request schema from memory.

### Day 4 — Mock Streaming
- Goal: understand NDJSON streaming.
- What you type: token generator and `done` chunk.
- Why it works: chunked output makes UI feel instant.
- Break test: remove newline between chunks and watch parser fail.
- Own rewrite: write a minimal stream generator from scratch.

### Day 5 — Frontend Chat Shell
- Goal: render chat messages and input.
- What you type: message list, textarea, send button.
- Why it works: UI state mirrors backend conversation flow.
- Break test: remove assistant placeholder and observe missing stream target.
- Own rewrite: rebuild chat component layout.

### Day 6 — Stream Rendering + Debug Panel
- Goal: append streamed tokens incrementally.
- What you type: `streamChat()` parser + debug panel state.
- Why it works: each token chunk updates a single assistant message.
- Break test: force malformed JSON chunk and inspect error handling.
- Own rewrite: implement line-buffer parser from memory.

### Day 7 — Review + Deletion Test
- Goal: verify understanding.
- What you type: bug journal + one file rewrite.
- Why it works: memory + debugging skill compounds weekly.
- Break test: delete one completed file and rebuild it.
- Own rewrite: compare with original and list knowledge gaps.

## Week 2 Preview
- Real Claude integration with `CLAUDE_API_KEY`.
- GPT-4o switch path with `OPENAI_API_KEY`.
- Keep same endpoint and UI contract.
