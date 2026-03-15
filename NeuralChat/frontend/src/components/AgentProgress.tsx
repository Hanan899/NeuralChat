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
      className="px-2 py-1 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white transition-colors select-none"
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

// Renders markdown with Tailwind styling + VS Code-style syntax highlighted code blocks.
function MarkdownContent({ content, className = "" }: { content: string; className?: string }) {
  return (
    <ReactMarkdown
      className={className}
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        h1: ({ children }) => (
          <h1 className="text-xl font-bold mt-4 mb-2">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-lg font-semibold mt-3 mb-2">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-base font-semibold mt-3 mb-1">{children}</h3>
        ),
        p: ({ children }) => (
          <p className="mb-2 leading-relaxed">{children}</p>
        ),
        ul: ({ children }) => (
          <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>
        ),
        li: ({ children }) => (
          <li className="ml-2">{children}</li>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold">{children}</strong>
        ),
        em: ({ children }) => (
          <em className="italic">{children}</em>
        ),

        // Tables — fully CSS-variable driven, no hardcoded dark colors
        table: ({ children }) => (
          <div style={{
            overflowX: "auto",
            marginBottom: "16px",
            borderRadius: "12px",
            border: "1px solid var(--border-subtle)",
            background: "var(--bg-input)",
          }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
              {children}
            </table>
          </div>
        ),
        thead: ({ children }) => (
          <thead style={{ background: "rgba(108, 99, 212, 0.08)" }}>
            {children}
          </thead>
        ),
        th: ({ children }) => (
          <th style={{
            padding: "10px 14px",
            textAlign: "left",
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--accent-primary)",
            borderBottom: "1px solid rgba(108, 99, 212, 0.15)",
            whiteSpace: "nowrap",
            background: "transparent",
          }}>
            {children}
          </th>
        ),
        tbody: ({ children }) => <tbody>{children}</tbody>,
        tr: ({ children, ...props }) => (
          <tr style={{
            borderBottom: "1px solid var(--border-soft)",
            transition: "background 120ms ease",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          {...props}>
            {children}
          </tr>
        ),
        td: ({ children }) => (
          <td style={{
            padding: "9px 14px",
            color: "var(--text-primary)",
            verticalAlign: "top",
            lineHeight: "1.5",
            fontSize: "13px",
          }}>
            {children}
          </td>
        ),

        // Fenced code blocks → react-syntax-highlighter with vscDarkPlus theme.
        // Inline code → subtle rose highlight.
        code: ({ children, className: codeClass }) => {
          const language = codeClass?.replace("language-", "") ?? "";
          const isBlock = Boolean(codeClass?.startsWith("language-"));
          const codeText = String(children).replace(/\n$/, "");

          if (isBlock) {
            return (
              <div className="mb-3 rounded-lg overflow-hidden border border-gray-700">
                {/* Top bar: language label + copy button */}
                <div className="flex items-center justify-between bg-[#1e1e1e] px-4 py-2 border-b border-gray-700">
                  <span className="text-xs text-gray-400 font-mono tracking-wide">
                    {language || "code"}
                  </span>
                  <CopyButton text={codeText} />
                </div>

                {/* Syntax-highlighted code body */}
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

          // Inline code
          return (
            <code className="bg-gray-100 dark:bg-gray-700 text-rose-600 dark:text-rose-400 rounded px-1.5 py-0.5 text-sm font-mono">
              {children}
            </code>
          );
        },

        // Suppress default <pre> wrapper — handled inside <code> above.
        pre: ({ children }) => <>{children}</>,

        blockquote: ({ children }) => (
          <blockquote className="border-l-4 border-gray-300 dark:border-gray-600 pl-3 italic text-gray-600 dark:text-gray-400 mb-2">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="my-3" style={{ borderColor: "var(--border-subtle)" }} />,
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
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
        const status =
          result?.status ?? (task.runningStepNumber === step.step_number ? "running" : "pending");
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