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

function UiIcon({
  kind,
  className
}: {
  kind: "brand" | "search" | "file";
  className?: string;
}) {
  if (kind === "brand") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={className}>
        <circle cx="12" cy="12" r="8.3" stroke="currentColor" strokeWidth="1.7" />
        <path d="M8 12C8 9.8 9.8 8 12 8C14.2 8 16 9.8 16 12C16 14.2 14.2 16 12 16" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }

  if (kind === "search") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={className}>
        <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" />
        <path d="M16 16L20 20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M11 4.5V17.5M4.5 11H17.5" stroke="currentColor" strokeWidth="1.2" opacity="0.65" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M7.5 5.5H13L17.5 10V18.5C17.5 19.3 16.8 20 16 20H7.5C6.7 20 6 19.3 6 18.5V7C6 6.2 6.7 5.5 7.5 5.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M13 5.5V10H17.5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function ActionIcon({ kind }: { kind: "up" | "down" | "copy" | "retry" }) {
  if (kind === "up") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <path
          d="M10 20H17C18.7 20 20 18.7 20 17V11.5C20 10.1 18.9 9 17.5 9H14V5.8C14 4.8 13.2 4 12.2 4C11.7 4 11.2 4.2 10.8 4.6L7 9V20H10Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path d="M7 20H4V10H7" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    );
  }

  if (kind === "down") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <path
          d="M14 4H7C5.3 4 4 5.3 4 7V12.5C4 13.9 5.1 15 6.5 15H10V18.2C10 19.2 10.8 20 11.8 20C12.3 20 12.8 19.8 13.2 19.4L17 15V4H14Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path d="M17 4H20V14H17" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    );
  }

  if (kind === "copy") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <rect x="9" y="9" width="10" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
        <path
          d="M15 9V7.5C15 6.1 13.9 5 12.5 5H7.5C6.1 5 5 6.1 5 7.5V14.5C5 15.9 6.1 17 7.5 17H9"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path
        d="M20 11C19.6 7.7 16.8 5 13.4 5C10 5 7.1 7.8 6.8 11.2"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M7 8L6.6 11.6L3 11.2"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 13C4.4 16.3 7.2 19 10.6 19C14 19 16.9 16.2 17.2 12.8"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M17 16L17.4 12.4L21 12.8"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path d="M6 12.5L10 16.5L18 8.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
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
  const [copiedMessage, setCopiedMessage] = useState(false);
  const [actionStatus, setActionStatus] = useState("");
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
                  <UiIcon kind="file" className="nc-inline-ui-icon" />
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

  function handleFeedback(nextFeedback: "up" | "down") {
    const resolvedFeedback = feedback === nextFeedback ? null : nextFeedback;
    setFeedback(resolvedFeedback);
    setActionStatus(
      resolvedFeedback === null ? "Feedback cleared" : resolvedFeedback === "up" ? "Marked helpful" : "Marked unhelpful"
    );
    window.setTimeout(() => setActionStatus(""), 1800);
  }

  async function handleCopyMessage() {
    await navigator.clipboard.writeText(message.content);
    setCopiedMessage(true);
    setActionStatus("Copied to clipboard");
    window.setTimeout(() => {
      setCopiedMessage(false);
      setActionStatus("");
    }, 1800);
  }

  return (
    <div className="nc-message nc-message--assistant" data-testid="message-assistant">
      <span className={`nc-assistant-avatar ${isStreaming ? "nc-assistant-avatar--streaming" : ""}`} aria-hidden="true">
        <UiIcon kind="brand" className="nc-assistant-avatar__icon" />
      </span>

      <article className="nc-assistant-content">
        {showAssistantLabel ? (
          <p className="nc-assistant-label">
            <span>NeuralChat</span>
            {message.searchUsed ? (
              <span title="Answer includes web search results" aria-label="Search used">
                <UiIcon kind="search" className="nc-inline-ui-icon" />
              </span>
            ) : null}
            {message.fileContextUsed ? (
              <span title="Answer includes content from your uploaded files" aria-label="File context used">
                <UiIcon kind="file" className="nc-inline-ui-icon" />
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
              aria-pressed={feedback === "up"}
              title={feedback === "up" ? "Remove helpful feedback" : "Mark response helpful"}
              className={feedback === "up" ? "nc-message-actions__active" : ""}
              onClick={() => handleFeedback("up")}
            >
              <ActionIcon kind="up" />
            </button>
            <button
              type="button"
              aria-label="Thumbs down"
              aria-pressed={feedback === "down"}
              title={feedback === "down" ? "Remove unhelpful feedback" : "Mark response unhelpful"}
              className={feedback === "down" ? "nc-message-actions__active" : ""}
              onClick={() => handleFeedback("down")}
            >
              <ActionIcon kind="down" />
            </button>
            <button
              type="button"
              aria-label="Copy message"
              title={copiedMessage ? "Copied" : "Copy response"}
              className={copiedMessage ? "nc-message-actions__active" : ""}
              onClick={handleCopyMessage}
            >
              {copiedMessage ? <StatusIcon /> : <ActionIcon kind="copy" />}
            </button>
            <button type="button" aria-label="Retry response" title="Generate again" onClick={onRetry} disabled={!onRetry}>
              <ActionIcon kind="retry" />
            </button>
            {actionStatus ? <span className="nc-message-actions__status">{actionStatus}</span> : null}
          </div>
        ) : null}
      </article>
    </div>
  );
}
