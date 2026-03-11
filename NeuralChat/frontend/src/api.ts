import type { ChatRequest, StreamChunk } from "./types";

// Default to Azure Functions local runtime (`func start`).
// Override with VITE_API_BASE_URL when needed (e.g., uvicorn on :8000).
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:7071";

export async function checkHealth(): Promise<boolean> {
  const response = await fetch(`${API_BASE_URL}/api/health`);
  return response.ok;
}

export async function streamChat(
  payload: ChatRequest,
  authToken: string,
  onChunk: (chunk: StreamChunk) => void
): Promise<{ requestId: string; responseMs: number; firstTokenMs: number | null; tokensEmitted: number }> {
  const startedAt = performance.now();

  const response = await fetch(`${API_BASE_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Backend request failed.");
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Streaming is not supported in this browser.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let sawDone = false;
  let doneChunk: StreamChunk | null = null;
  let streamError = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      const chunk = JSON.parse(line) as StreamChunk;
      if (chunk.type === "done") {
        sawDone = true;
        doneChunk = chunk;
      }
      if (chunk.type === "error") {
        streamError = chunk.content || "Streaming interrupted.";
      }
      onChunk(chunk);
    }
  }

  if (buffer.trim()) {
    const chunk = JSON.parse(buffer) as StreamChunk;
    if (chunk.type === "done") {
      sawDone = true;
      doneChunk = chunk;
    }
    if (chunk.type === "error") {
      streamError = chunk.content || "Streaming interrupted.";
    }
    onChunk(chunk);
  }

  if (streamError) {
    throw new Error(streamError);
  }

  if (!sawDone) {
    throw new Error("Connection dropped before completion. Partial response was received.");
  }

  const responseMs = Math.round(performance.now() - startedAt);
  const requestId = doneChunk?.request_id ?? response.headers.get("x-request-id") ?? "unknown-request";
  const firstTokenMs = typeof doneChunk?.first_token_ms === "number" ? doneChunk.first_token_ms : null;
  const tokensEmitted = typeof doneChunk?.tokens_emitted === "number" ? doneChunk.tokens_emitted : 0;
  const responseMsFromDone = typeof doneChunk?.response_ms === "number" ? doneChunk.response_ms : responseMs;
  return { requestId, responseMs: responseMsFromDone, firstTokenMs, tokensEmitted };
}
