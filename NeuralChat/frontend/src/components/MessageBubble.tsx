import type { ChatMessage } from "../types";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <article
      className={`max-w-xl rounded-xl px-4 py-3 shadow-sm ${
        isUser ? "ml-auto bg-brand-accent text-white" : "mr-auto bg-white text-brand-dark"
      }`}
    >
      <p className="mb-1 text-xs uppercase opacity-80">{isUser ? "You" : `Assistant (${message.model})`}</p>
      <p className="whitespace-pre-wrap">{message.content}</p>
    </article>
  );
}
