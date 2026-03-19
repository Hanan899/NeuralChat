import { useMemo, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { AgentTaskState } from "../types";

interface AgentProgressProps {
  task: AgentTaskState;
  onRun?: () => void;
}

// Copy-to-clipboard button shown in the top-right corner of every code block.
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — fail silently.
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="nc-agent-md__copy-btn"
    >
      {copied ? "✓ Copied" : "Copy"}
    </button>
  );
}

function StatusIcon({ status }: { status: "pending" | "running" | "done" | "failed" }) {
  if (status === "done") {
    return (
      <span className="nc-step-badge nc-step-badge--done">
        <svg viewBox="0 0 16 16" fill="none" width="11" height="11">
          <path d="M3 8L6.5 11.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Done
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="nc-step-badge nc-step-badge--failed">
        <svg viewBox="0 0 16 16" fill="none" width="11" height="11">
          <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
        Failed
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="nc-step-badge nc-step-badge--running">
        <span className="nc-step-badge__pulse" />
        Running
      </span>
    );
  }
  return (
    <span className="nc-step-badge nc-step-badge--pending">
      Pending
    </span>
  );
}

// Tool label shown inside step rows
function ToolBadge({ tool }: { tool: string | null | undefined }) {
  if (!tool) return null;
  const labels: Record<string, { icon: string; label: string }> = {
    web_search:    { icon: "🔍", label: "Web search" },
    read_file:     { icon: "📄", label: "File" },
    memory_recall: { icon: "🧠", label: "Memory" },
  };
  const meta = labels[tool];
  if (!meta) return null;
  return (
    <span className="nc-step-tool-badge">
      {meta.icon} {meta.label}
    </span>
  );
}

// Renders markdown using the shared NeuralChat CSS system so it stays theme-aware and responsive.
function MarkdownContent({ content, className = "" }: { content: string; className?: string }) {
  return (
    <ReactMarkdown
      className={`nc-agent-md ${className}`.trim()}
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        h1: ({ children }) => (
          <h1 className="nc-agent-md__h1">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="nc-agent-md__h2">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="nc-agent-md__h3">{children}</h3>
        ),
        p: ({ children }) => (
          <p className="nc-agent-md__p">{children}</p>
        ),
        ul: ({ children }) => (
          <ul className="nc-agent-md__list nc-agent-md__list--unordered">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="nc-agent-md__list nc-agent-md__list--ordered">{children}</ol>
        ),
        li: ({ children }) => (
          <li className="nc-agent-md__list-item">{children}</li>
        ),
        strong: ({ children }) => (
          <strong className="nc-agent-md__strong">{children}</strong>
        ),
        em: ({ children }) => (
          <em className="nc-agent-md__em">{children}</em>
        ),
        table: ({ children }) => (
          <div className="nc-agent-md__table-wrap">
            <table className="nc-agent-md__table">{children}</table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="nc-agent-md__thead">{children}</thead>
        ),
        th: ({ children }) => (
          <th className="nc-agent-md__th">{children}</th>
        ),
        tbody: ({ children }) => <tbody>{children}</tbody>,
        tr: ({ children }) => (
          <tr className="nc-agent-md__tr">{children}</tr>
        ),
        td: ({ children }) => (
          <td className="nc-agent-md__td">{children}</td>
        ),
        code: ({ children, className: codeClass }) => {
          const language = codeClass?.replace("language-", "") ?? "";
          const isBlock = Boolean(codeClass?.startsWith("language-"));
          const codeText = String(children).replace(/\n$/, "");

          if (isBlock) {
            return (
              <div className="nc-agent-md__code-block">
                <div className="nc-agent-md__code-head">
                  <span className="nc-agent-md__code-lang">{language || "code"}</span>
                  <CopyButton text={codeText} />
                </div>
                <SyntaxHighlighter
                  language={language || "text"}
                  style={vscDarkPlus}
                  customStyle={{
                    margin: 0,
                    borderRadius: 0,
                    padding: "1rem",
                    fontSize: "0.875rem",
                    lineHeight: "1.6",
                    background: "#1e1e1e",
                  }}
                  codeTagProps={{
                    style: {
                      fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', monospace",
                    },
                  }}
                  showLineNumbers={codeText.split("\n").length > 4}
                  lineNumberStyle={{
                    color: "#4a4a4a",
                    minWidth: "2.5em",
                    paddingRight: "1em",
                    userSelect: "none",
                  }}
                  wrapLongLines={false}
                >
                  {codeText}
                </SyntaxHighlighter>
              </div>
            );
          }

          return (
            <code className="nc-agent-md__inline-code">
              {children}
            </code>
          );
        },
        pre: ({ children }) => <>{children}</>,
        blockquote: ({ children }) => (
          <blockquote className="nc-agent-md__blockquote">{children}</blockquote>
        ),
        hr: () => <hr className="nc-agent-md__hr" />,
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="nc-agent-md__link"
          >
            {children}
          </a>
        ),
      }}
      children={content}
    />
  );
}

export function AgentProgress({ task, onRun }: AgentProgressProps) {
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({});

  const steps = useMemo(
    () =>
      task.plan.steps.map((step) => {
        const result = task.stepResults.find((item) => item.step_number === step.step_number);
        const status = (
          result?.status ?? (task.runningStepNumber === step.step_number ? "running" : "pending")
        ) as "done" | "running" | "failed" | "pending";
        return {
          ...step,
          status,
          result: result?.result ?? "",
          error: result?.error ?? "",
        };
      }),
    [task]
  );

  const completedCount = steps.filter((s) => s.status === "done").length;
  const totalCount = steps.length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const isRunning = task.status === "running";
  const isCompleted = task.status === "completed";
  const isFailed = task.status === "failed";

  return (
    <section className="nc-agent-card" data-testid="agent-progress">

      {/* ── Header ── */}
      <div className="nc-agent-header">
        <div className="nc-agent-header__left">
          {/* Status orb */}
          <span className={`nc-agent-orb nc-agent-orb--${task.status}`}>
            {isCompleted ? (
              <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
                <path d="M4 10L8.5 14.5L16 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : isFailed ? (
              <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
                <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
              </svg>
            ) : isRunning ? (
              <span className="nc-agent-orb__spinner" />
            ) : (
              <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
                <rect x="6" y="8" width="8" height="6" rx="2.5" stroke="currentColor" strokeWidth="1.8"/>
                <path d="M10 4V8M8 16H12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                <circle cx="8.5" cy="11" r="0.7" fill="currentColor"/>
                <circle cx="11.5" cy="11" r="0.7" fill="currentColor"/>
              </svg>
            )}
          </span>

          <div className="nc-agent-header__meta">
            <span className="nc-agent-header__label">Agent plan</span>
            <h3 className="nc-agent-header__goal">{task.plan.goal}</h3>
          </div>
        </div>

        <div className="nc-agent-header__right">
          {task.status === "preview" && onRun ? (
            <button type="button" className="nc-agent-run-btn" onClick={onRun}>
              <svg viewBox="0 0 20 20" fill="none" width="13" height="13">
                <path d="M6 4L16 10L6 16V4Z" fill="currentColor"/>
              </svg>
              Run plan
            </button>
          ) : (
            <span className={`nc-agent-status-pill nc-agent-status-pill--${task.status}`}>
              {isCompleted ? "✓ Completed" : isFailed ? "✗ Failed" : isRunning ? "Running…" : task.status}
            </span>
          )}
        </div>
      </div>

      {/* ── Progress bar (only when running or completed) ── */}
      {(isRunning || isCompleted) && totalCount > 0 ? (
        <div className="nc-agent-progress-track">
          <div
            className={`nc-agent-progress-fill ${isCompleted ? "nc-agent-progress-fill--done" : ""}`}
            style={{ width: `${progressPct}%` }}
          />
          <span className="nc-agent-progress-label">
            {completedCount}/{totalCount} steps
          </span>
        </div>
      ) : null}

      {/* ── Steps ── */}
      <ol className="nc-agent-steps-v2">
        {steps.map((step) => {
          const hasDetails = Boolean(step.result || step.error);
          const isExpanded = expandedSteps[step.step_number] ?? false;
          const isActiveStep = isRunning && task.runningStepNumber === step.step_number;

          return (
            <li
              key={step.step_number}
              className={`nc-step-item nc-step-item--${step.status} ${isActiveStep ? "nc-step-item--active" : ""}`}
            >
              <button
                type="button"
                className="nc-step-item__row"
                onClick={() => {
                  if (hasDetails) {
                    setExpandedSteps((prev) => ({
                      ...prev,
                      [step.step_number]: !isExpanded,
                    }));
                  }
                }}
                disabled={!hasDetails}
              >
                {/* Left: connector line + number */}
                <span className="nc-step-item__track">
                  <span className="nc-step-item__dot">
                    {step.status === "done" ? (
                      <svg viewBox="0 0 12 12" fill="none" width="9" height="9">
                        <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    ) : step.status === "failed" ? (
                      <svg viewBox="0 0 12 12" fill="none" width="9" height="9">
                        <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    ) : step.status === "running" ? (
                      <span style={{ width: 7, height: 7, borderRadius: "999px", background: "currentColor", display: "inline-block", animation: "nc-pulse-dot 1.2s ease-in-out infinite" }} />
                    ) : (
                      <span style={{ fontSize: "9px", fontWeight: 700, lineHeight: 1 }}>{step.step_number}</span>
                    )}
                  </span>
                </span>

                {/* Middle: description + tool badge */}
                <span className="nc-step-item__body">
                  <span className="nc-step-item__desc">{step.description}</span>
                  <ToolBadge tool={step.tool} />
                </span>

                {/* Right: status + chevron */}
                <span className="nc-step-item__right">
                  <StatusIcon status={step.status} />
                  {hasDetails ? (
                    <svg
                      className={`nc-step-item__chevron ${isExpanded ? "nc-step-item__chevron--open" : ""}`}
                      viewBox="0 0 16 16" fill="none" width="12" height="12"
                    >
                      <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ) : null}
                </span>
              </button>

              {/* Expanded detail panel */}
              {hasDetails && isExpanded ? (
                <div className="nc-step-item__detail">
                  {step.error ? (
                    <div className="nc-step-item__error-box">
                      <svg viewBox="0 0 16 16" fill="none" width="13" height="13">
                        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5"/>
                        <path d="M8 5V8.5M8 11H8.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                      </svg>
                      {step.error}
                    </div>
                  ) : null}
                  {step.result ? (
                    <MarkdownContent content={step.result} className="nc-step-item__result-md" />
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {/* ── Warning ── */}
      {task.warning ? (
        <div className="nc-agent-warning-v2">
          <svg viewBox="0 0 20 20" fill="none" width="14" height="14" style={{ flexShrink: 0 }}>
            <path d="M10 3L18 17H2L10 3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
            <path d="M10 9V12M10 14.5H10.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
          {task.warning}
        </div>
      ) : null}

      {/* ── Final summary ── */}
      {(task.summary || task.status === "running" || task.status === "preview") ? (
        <div className="nc-agent-summary-v2">
          <div className="nc-agent-summary-v2__header">
            <svg viewBox="0 0 20 20" fill="none" width="13" height="13">
              <path d="M3 5H17M3 10H13M3 15H10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
            <span>Summary</span>
          </div>
          <div className="nc-agent-summary-v2__body">
            {task.summary ? (
              <>
                <MarkdownContent content={task.summary} className="nc-agent-summary-v2__md" />
                {isRunning ? <span className="typing-cursor" aria-hidden="true" /> : null}
              </>
            ) : isRunning ? (
              <div className="nc-agent-summary-v2__thinking">
                <span className="nc-thinking-dot" style={{ animationDelay: "0ms" }} />
                <span className="nc-thinking-dot" style={{ animationDelay: "160ms" }} />
                <span className="nc-thinking-dot" style={{ animationDelay: "320ms" }} />
                <span style={{ marginLeft: "8px", fontSize: "13px", color: "var(--text-secondary)" }}>
                  Generating summary…
                </span>
              </div>
            ) : (
              <p className="nc-agent-summary-v2__placeholder">
                Run the plan to see results here.
              </p>
            )}
          </div>
        </div>
      ) : null}

    </section>
  );
}
