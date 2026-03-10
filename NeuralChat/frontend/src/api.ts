import type { ChatRequest, StreamChunk } from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export async function checkHealth(): Promise<boolean> {
  const response = await fetch(`${API_BASE_URL}/api/health`);
  return response.ok;
}

export async function streamChat(
  payload: ChatRequest,
  onChunk: (chunk: StreamChunk) => void
): Promise<{ requestId: string; responseMs: number }> {
  const startedAt = performance.now();

  const response = await fetch(`${API_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
      onChunk(chunk);
    }
  }

  if (buffer.trim()) {
    onChunk(JSON.parse(buffer) as StreamChunk);
  }

  const responseMs = Math.round(performance.now() - startedAt);
  const requestId = response.headers.get("x-request-id") ?? "unknown-request";
  return { requestId, responseMs };
}
