import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js";

import type { ChatMessage } from "../types";
import { SearchSources } from "./SearchSources";

interface MessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
  showAssistantLabel?: boolean;
  onRetry?: () => void;
}

interface CodeBlockProps {
  className?: string;
  children?: React.ReactNode;
}

function CodeBlock({ className, children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const language = className?.replace("language-", "").trim() || "text";
  const rawCode = String(children ?? "").replace(/\n$/, "");

  const highlightedHtml = useMemo(() => {
    if (!rawCode) {
      return "";
    }
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(rawCode, { language }).value;
    }
    return hljs.highlightAuto(rawCode).value;
  }, [language, rawCode]);

  async function handleCopy() {
    await navigator.clipboard.writeText(rawCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <figure className="nc-code-block">
      <figcaption>
        <span>{language}</span>
        <button type="button" onClick={handleCopy}>
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </figcaption>
      <pre>
        <code className={`hljs language-${language}`} dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
      </pre>
    </figure>
  );
}

export function MessageBubble({
  message,
  isStreaming = false,
  showAssistantLabel = false,
  onRetry
}: MessageBubbleProps) {
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const isUser = message.role === "user";
  const hasAssistantContent = message.content.trim().length > 0;
  const showMessageActions = hasAssistantContent && !isStreaming;

  if (isUser) {
    return (
      <div className="nc-message nc-message--user" data-testid="message-user">
        <article className="nc-user-bubble">
          {Array.isArray(message.attachedFiles) && message.attachedFiles.length > 0 ? (
            <div className="nc-user-attachments" aria-label="Files attached to this message">
              {message.attachedFiles.map((fileItem) => (
                <span key={fileItem.blob_path} className="nc-user-attachment-chip" title={fileItem.filename}>
                  <span aria-hidden="true">📄</span>
                  <span>{fileItem.filename}</span>
                </span>
              ))}
            </div>
          ) : null}
          <p>{message.content}</p>
        </article>
        <span className="nc-user-avatar" aria-hidden="true">
          U
        </span>
      </div>
    );
  }

  async function handleCopyMessage() {
    await navigator.clipboard.writeText(message.content);
  }

  return (
    <div className="nc-message nc-message--assistant" data-testid="message-assistant">
      <span className={`nc-assistant-avatar ${isStreaming ? "nc-assistant-avatar--streaming" : ""}`} aria-hidden="true">
        ✶
      </span>

      <article className="nc-assistant-content">
        {showAssistantLabel ? (
          <p className="nc-assistant-label">
            <span>NeuralChat</span>
            {message.searchUsed ? (
              <span title="Answer includes web search results" aria-label="Search used">
                🌐
              </span>
            ) : null}
            {message.fileContextUsed ? (
              <span title="Answer includes content from your uploaded files" aria-label="File context used">
                📄
              </span>
            ) : null}
          </p>
        ) : null}

        <div className="nc-markdown">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }) {
                const isInline = !(className && className.startsWith("language-"));
                if (isInline) {
                  return (
                    <code className="nc-inline-code" {...props}>
                      {children}
                    </code>
                  );
                }
                return <CodeBlock className={className}>{children}</CodeBlock>;
              }
            }}
          >
            {message.content}
          </ReactMarkdown>

          {isStreaming ? <span className="typing-cursor" aria-hidden="true" /> : null}
        </div>

        {message.searchUsed ? <SearchSources sources={message.sources ?? []} /> : null}

        {showMessageActions ? (
          <div className="nc-message-actions" aria-label="Assistant message actions">
            <button
              type="button"
              aria-label="Thumbs up"
              className={feedback === "up" ? "nc-message-actions__active" : ""}
              onClick={() => setFeedback("up")}
            >
              👍
            </button>
            <button
              type="button"
              aria-label="Thumbs down"
              className={feedback === "down" ? "nc-message-actions__active" : ""}
              onClick={() => setFeedback("down")}
            >
              👎
            </button>
            <button type="button" aria-label="Copy message" onClick={handleCopyMessage}>
              📋
            </button>
            <button type="button" aria-label="Retry response" onClick={onRetry} disabled={!onRetry}>
              🔄
            </button>
          </div>
        ) : null}
      </article>
    </div>
  );
}
