import { SignIn, SignedIn, SignedOut, UserButton, useAuth } from "@clerk/clerk-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { checkHealth, streamChat } from "./api";
import { ChatWindow } from "./components/ChatWindow";
import { DebugPanel } from "./components/DebugPanel";
import { ModelSelector } from "./components/ModelSelector";
import type { ChatMessage, ChatModel, StreamChunk } from "./types";

function buildId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function resolveSessionId(userId: string): string {
  const storageKey = `neuralchat:session:${userId}`;
  const existing = window.localStorage.getItem(storageKey);
  if (existing) {
    return existing;
  }

  const created = `session-${userId}-${crypto.randomUUID()}`;
  window.localStorage.setItem(storageKey, created);
  return created;
}

function ChatShell() {
  const { getToken, userId } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState<ChatModel>("claude");
  const [isSending, setIsSending] = useState(false);
  const [backendHealthy, setBackendHealthy] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [responseMs, setResponseMs] = useState<number | null>(null);
  const [firstTokenMs, setFirstTokenMs] = useState<number | null>(null);
  const [tokensEmitted, setTokensEmitted] = useState(0);
  const [streamStatus, setStreamStatus] = useState("idle");
  const [errorText, setErrorText] = useState("");

  const sessionId = useMemo(() => {
    if (!userId) {
      return "session-unknown";
    }
    return resolveSessionId(userId);
  }, [userId]);

  useEffect(() => {
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
    setStreamStatus("streaming");
    setTokensEmitted(0);
    setFirstTokenMs(null);

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
      const authToken = await getToken();
      if (!authToken) {
        throw new Error("Authentication token unavailable. Please sign in again.");
      }

      const result = await streamChat(
        {
          session_id: sessionId,
          message: trimmed,
          model,
          stream: true
        },
        authToken,
        (chunk: StreamChunk) => {
          if (chunk.type === "token") {
            setTokensEmitted((value) => value + 1);
            setMessages((previous) =>
              previous.map((msg) => (msg.id === assistantId ? { ...msg, content: `${msg.content}${chunk.content}` } : msg))
            );
          }

          if (chunk.type === "error") {
            setStreamStatus("interrupted");
            setErrorText(chunk.content || "Streaming error received.");
          }

          if (chunk.type === "done") {
            setStreamStatus(chunk.status ?? "completed");
            if (chunk.request_id) {
              setRequestId(chunk.request_id);
            }
            if (typeof chunk.response_ms === "number") {
              setResponseMs(chunk.response_ms);
            }
            if (typeof chunk.first_token_ms === "number") {
              setFirstTokenMs(chunk.first_token_ms);
            }
            if (typeof chunk.tokens_emitted === "number") {
              setTokensEmitted(chunk.tokens_emitted);
            }
          }
        }
      );

      setRequestId(result.requestId);
      setResponseMs(result.responseMs);
      setFirstTokenMs(result.firstTokenMs);
      setTokensEmitted(result.tokensEmitted);
      setStreamStatus("completed");
    } catch (error) {
      const text = error instanceof Error ? error.message : "Unknown error";
      setStreamStatus("interrupted");
      setErrorText(`${text} (Partial response may be saved in backend memory.)`);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-brand-dark">NeuralChat</h1>
          <p className="text-sm text-slate-700">Authenticated chat with user-scoped cloud memory.</p>
        </div>
        <UserButton afterSignOutUrl="/" />
      </header>

      <DebugPanel
        selectedModel={model}
        requestId={requestId}
        responseMs={responseMs}
        firstTokenMs={firstTokenMs}
        tokensEmitted={tokensEmitted}
        streamStatus={streamStatus}
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

export default function App() {
  return (
    <>
      <SignedOut>
        <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col items-center justify-center gap-6 p-4">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-brand-dark">NeuralChat</h1>
            <p className="mt-2 text-slate-700">Sign in to access your personal AI workspace.</p>
          </div>
          <SignIn />
        </main>
      </SignedOut>

      <SignedIn>
        <ChatShell />
      </SignedIn>
    </>
  );
}
