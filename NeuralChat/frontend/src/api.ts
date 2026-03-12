import type { ChatRequest, SearchSource, StreamChunk } from "./types";

// Default to Azure Functions local runtime (`func start`).
// Override with VITE_API_BASE_URL when needed (e.g., uvicorn on :8000).
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:7071";

export interface MeResponse {
  user_id: string;
  profile: Record<string, unknown>;
}

export async function checkHealth(): Promise<boolean> {
  const response = await fetch(`${API_BASE_URL}/api/health`);
  return response.ok;
}

export async function streamChat(
  payload: ChatRequest,
  authToken: string,
  onChunk: (chunk: StreamChunk) => void,
  signal?: AbortSignal
): Promise<{
  requestId: string;
  responseMs: number;
  firstTokenMs: number | null;
  tokensEmitted: number;
  searchUsed: boolean;
  sources: SearchSource[];
}> {
  const startedAt = performance.now();

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`
      },
      body: JSON.stringify(payload),
      signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Generation stopped by user.");
    }
    throw error;
  }

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

  try {
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
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Generation stopped by user.");
    }
    throw error;
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
  const searchUsed = doneChunk?.search_used === true;
  const sources = Array.isArray(doneChunk?.sources) ? doneChunk.sources : [];

  return {
    requestId,
    responseMs: responseMsFromDone,
    firstTokenMs,
    tokensEmitted,
    searchUsed,
    sources
  };
}

export async function checkSearchStatus(): Promise<boolean> {
  const response = await fetch(`${API_BASE_URL}/api/search/status`);
  if (!response.ok) {
    return false;
  }
  const payload = (await response.json()) as { search_enabled?: boolean };
  return payload.search_enabled === true;
}

export async function getMe(authToken: string): Promise<MeResponse> {
  const response = await fetch(`${API_BASE_URL}/api/me`, {
    headers: {
      Authorization: `Bearer ${authToken}`
    }
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Failed to load memory.");
  }
  return (await response.json()) as MeResponse;
}

export async function patchMemory(authToken: string, key: string, value: string): Promise<MeResponse> {
  const response = await fetch(`${API_BASE_URL}/api/me/memory`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({ key, value })
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Failed to update memory.");
  }
  return (await response.json()) as MeResponse;
}

export async function deleteMemory(authToken: string): Promise<{ message: string }> {
  const response = await fetch(`${API_BASE_URL}/api/me/memory`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${authToken}`
    }
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Failed to clear memory.");
  }
  return (await response.json()) as { message: string };
}
