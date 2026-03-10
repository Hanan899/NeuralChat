import { FormEvent, useEffect, useMemo, useState } from "react";

import { checkHealth, streamChat } from "./api";
import { ChatWindow } from "./components/ChatWindow";
import { DebugPanel } from "./components/DebugPanel";
import { ModelSelector } from "./components/ModelSelector";
import type { ChatMessage, ChatModel, StreamChunk } from "./types";

function buildId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState<ChatModel>("claude");
  const [isSending, setIsSending] = useState(false);
  const [backendHealthy, setBackendHealthy] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [responseMs, setResponseMs] = useState<number | null>(null);
  const [errorText, setErrorText] = useState("");

  const sessionId = useMemo(() => "session-local-001", []);

  useEffect(() => {
    // Explain this code: we ping backend once on page load.
    checkHealth().then(setBackendHealthy).catch(() => setBackendHealthy(false));
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = input.trim();
    if (!trimmed || isSending) {
      return;
    }

    setErrorText("");
    setIsSending(true);

    const userMessage: ChatMessage = {
      id: buildId(),
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
      model
    };

    const assistantId = buildId();
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      model
    };

    setMessages((previous) => [...previous, userMessage, assistantMessage]);
    setInput("");

    try {
      const result = await streamChat(
        {
          session_id: sessionId,
          message: trimmed,
          model,
          stream: true
        },
        (chunk: StreamChunk) => {
          if (chunk.type === "token") {
            setMessages((previous) =>
              previous.map((msg) => (msg.id === assistantId ? { ...msg, content: `${msg.content}${chunk.content}` } : msg))
            );
          }

          if (chunk.type === "error") {
            setErrorText(chunk.content || "Streaming error received.");
          }

          if (chunk.type === "done") {
            if (chunk.request_id) {
              setRequestId(chunk.request_id);
            }
            if (typeof chunk.response_ms === "number") {
              setResponseMs(chunk.response_ms);
            }
          }
        }
      );

      setRequestId(result.requestId);
      if (responseMs === null) {
        setResponseMs(result.responseMs);
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : "Unknown error";
      setErrorText(text);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-4 p-4">
      <header>
        <h1 className="text-3xl font-bold text-brand-dark">NeuralChat</h1>
        <p className="text-sm text-slate-700">Beginner build: streaming chat + model switch + debug visibility.</p>
      </header>

      <DebugPanel
        selectedModel={model}
        requestId={requestId}
        responseMs={responseMs}
        backendHealthy={backendHealthy}
      />

      <ChatWindow messages={messages} />

      <form onSubmit={handleSubmit} className="rounded-lg border border-slate-300 bg-white p-3">
        <div className="mb-2 flex items-center justify-between">
          <ModelSelector value={model} onChange={setModel} />
          <span className="text-xs text-slate-500">Session: {sessionId}</span>
        </div>

        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          rows={4}
          className="w-full rounded-md border border-slate-300 p-2"
          placeholder="Ask NeuralChat anything..."
        />

        <div className="mt-2 flex items-center justify-between">
          <button
            type="submit"
            disabled={isSending}
            className="rounded-md bg-brand-dark px-4 py-2 text-white disabled:opacity-50"
          >
            {isSending ? "Streaming..." : "Send"}
          </button>
          {errorText ? <p className="text-sm text-red-600">{errorText}</p> : null}
        </div>
      </form>
    </main>
  );
}
