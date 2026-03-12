import type { ChatMessage } from "../types";
import { SearchSources } from "./SearchSources";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const searchUsed = message.searchUsed === true && message.role === "assistant";

  return (
    <article
      className={`max-w-xl rounded-xl px-4 py-3 shadow-sm ${
        isUser ? "ml-auto bg-brand-accent text-white" : "mr-auto bg-white text-brand-dark"
      }`}
    >
      <p className="mb-1 flex items-center gap-2 text-xs uppercase opacity-80">
        <span>{isUser ? "You" : `Assistant (${message.model})`}</span>
        {searchUsed ? (
          <span title="Answer includes web search results" aria-label="Search used">
            🌐
          </span>
        ) : null}
      </p>
      <p className="whitespace-pre-wrap">{message.content}</p>
      {searchUsed ? <SearchSources sources={message.sources ?? []} /> : null}
    </article>
  );
}
