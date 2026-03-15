import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import hljs from "highlight.js";

import type { ChatMessage } from "../types";
import { AgentProgress } from "./AgentProgress";
import { SearchSources } from "./SearchSources";

// Normalizes various LaTeX delimiters that GPT outputs into standard KaTeX format.
// GPT often uses [ ... ] for block math and ( ... ) for inline instead of $$ and $.
function normalizeMath(raw: string | null | undefined): string {
  if (!raw) return "";
  let text = raw;
  // \[ ... \] block math → $$ ... $$
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, eq) => `\n$$\n${eq.trim()}\n$$\n`);
  // \( ... \) inline math → $ ... $
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_, eq) => `$${eq.trim()}$`);
  // GPT-5 bare [ ... ] on its own lines → $$ ... $$
  text = text.replace(/^\[\s*\n([\s\S]*?)\n\s*\]$/gm, (_, eq) => `$$\n${eq.trim()}\n$$`);
  return text;
}

function UiIcon({
  kind,
  className
}: {
  kind: "brand" | "search" | "file";
  className?: string;
}) {
  if (kind === "brand") {
    // Neural network logo — matches the app-wide brand mark exactly.
    // Sized at 20×20 to fit neatly inside the assistant avatar circle.
    // Uses currentColor so it inherits the avatar's foreground color.
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 36 36"
        width="20"
        height="20"
        fill="none"
        className={className}
      >
        {/* Input → Hidden connections */}
        <line x1="5"  y1="9"  x2="16" y2="5"  stroke="currentColor" strokeWidth="1" strokeOpacity="0.55"/>
        <line x1="5"  y1="9"  x2="16" y2="18" stroke="currentColor" strokeWidth="1" strokeOpacity="0.55"/>
        <line x1="5"  y1="9"  x2="16" y2="31" stroke="currentColor" strokeWidth="1" strokeOpacity="0.30"/>
        <line x1="5"  y1="27" x2="16" y2="5"  stroke="currentColor" strokeWidth="1" strokeOpacity="0.30"/>
        <line x1="5"  y1="27" x2="16" y2="18" stroke="currentColor" strokeWidth="1" strokeOpacity="0.55"/>
        <line x1="5"  y1="27" x2="16" y2="31" stroke="currentColor" strokeWidth="1" strokeOpacity="0.55"/>
        {/* Hidden → Output connections */}
        <line x1="16" y1="5"  x2="31" y2="12" stroke="currentColor" strokeWidth="1" strokeOpacity="0.55"/>
        <line x1="16" y1="5"  x2="31" y2="24" stroke="currentColor" strokeWidth="1" strokeOpacity="0.30"/>
        <line x1="16" y1="18" x2="31" y2="12" stroke="currentColor" strokeWidth="1" strokeOpacity="0.65"/>
        <line x1="16" y1="18" x2="31" y2="24" stroke="currentColor" strokeWidth="1" strokeOpacity="0.65"/>
        <line x1="16" y1="31" x2="31" y2="12" stroke="currentColor" strokeWidth="1" strokeOpacity="0.30"/>
        <line x1="16" y1="31" x2="31" y2="24" stroke="currentColor" strokeWidth="1" strokeOpacity="0.55"/>
        {/* Input nodes — muted */}
        <circle cx="5"  cy="9"  r="2.8" fill="currentColor" fillOpacity="0.75"/>
        <circle cx="5"  cy="27" r="2.8" fill="currentColor" fillOpacity="0.75"/>
        {/* Hidden nodes */}
        <circle cx="16" cy="5"  r="2.8" fill="currentColor" fillOpacity="0.9"/>
        <circle cx="16" cy="18" r="3.4" fill="currentColor"/>
        <circle cx="16" cy="31" r="2.8" fill="currentColor" fillOpacity="0.9"/>
        {/* Output nodes */}
        <circle cx="31" cy="12" r="2.8" fill="currentColor"/>
        <circle cx="31" cy="24" r="2.8" fill="currentColor"/>
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
  onRetry,
  onRunAgentPlan,
}: MessageBubbleProps) {
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const [copiedMessage, setCopiedMessage] = useState(false);
  const [actionStatus, setActionStatus] = useState("");
  const isUser = message.role === "user";
  const hasAssistantContent = message.content.trim().length > 0;
  const showMessageActions = hasAssistantContent && !isStreaming && !message.agentTask;

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
            {message.agentTask ? (
              <span
                className="nc-assistant-badge nc-assistant-badge--agent"
                title="Response generated by Agent mode"
                aria-label="Agent mode"
              >
                <svg viewBox="0 0 24 24" fill="none" width="10" height="10" aria-hidden="true">
                  <rect x="7" y="8" width="10" height="8" rx="3" stroke="currentColor" strokeWidth="2"/>
                  <path d="M12 4V8M9 18H15M8 21H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <circle cx="10" cy="12" r="0.8" fill="currentColor"/>
                  <circle cx="14" cy="12" r="0.8" fill="currentColor"/>
                </svg>
                Agent
              </span>
            ) : null}
            {message.searchUsed ? (
              <span
                className="nc-assistant-badge nc-assistant-badge--search"
                title="Answer includes web search results"
                aria-label="Search used"
              >
                <svg viewBox="0 0 24 24" fill="none" width="10" height="10" aria-hidden="true">
                  <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2"/>
                  <path d="M16 16L20 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                Web search
              </span>
            ) : null}
            {message.fileContextUsed ? (
              <span
                className="nc-assistant-badge nc-assistant-badge--file"
                title="Answer includes content from your uploaded files"
                aria-label="File context used"
              >
                <svg viewBox="0 0 24 24" fill="none" width="10" height="10" aria-hidden="true">
                  <path d="M7.5 5.5H13L17.5 10V18.5C17.5 19.3 16.8 20 16 20H7.5C6.7 20 6 19.3 6 18.5V7C6 6.2 6.7 5.5 7.5 5.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
                  <path d="M13 5.5V10H17.5" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
                </svg>
                File context
              </span>
            ) : null}
          </p>
        ) : null}

        {message.agentTask ? (
          <AgentProgress task={message.agentTask} onRun={onRunAgentPlan} />
        ) : (
          <>
            <div className="nc-markdown">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex]}
                children={normalizeMath(message.content)}
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
              />

              {isStreaming ? <span className="typing-cursor" aria-hidden="true" /> : null}
            </div>

            {message.searchUsed ? <SearchSources sources={message.sources ?? []} /> : null}
          </>
        )}

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