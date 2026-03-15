import { useMemo, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
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
    return <span className="nc-agent-step__status nc-agent-step__status--done">Done</span>;
  }
  if (status === "failed") {
    return <span className="nc-agent-step__status nc-agent-step__status--failed">Failed</span>;
  }
  if (status === "running") {
    return <span className="nc-agent-step__status nc-agent-step__status--running">Running</span>;
  }
  return <span className="nc-agent-step__status">Pending</span>;
}

// Renders markdown with Tailwind styling + VS Code-style syntax highlighted code blocks.
function MarkdownContent({ content, className = "" }: { content: string; className?: string }) {
  return (
    <ReactMarkdown
      className={className}
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
        table: ({ children }) => (
          <div className="overflow-x-auto mb-3">
            <table className="min-w-full text-sm border-collapse border border-gray-200 dark:border-gray-700">
              {children}
            </table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border border-gray-200 dark:border-gray-700 px-3 py-1.5 bg-gray-50 dark:bg-gray-800 font-semibold text-left">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border border-gray-200 dark:border-gray-700 px-3 py-1.5">{children}</td>
        ),
        hr: () => <hr className="my-3 border-gray-200 dark:border-gray-700" />,
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
    >
      {content}
    </ReactMarkdown>
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

  return (
    <section className="nc-agent-card" data-testid="agent-progress">
      {/* Header */}
      <div className="nc-agent-card__header">
        <div>
          <p className="nc-agent-card__eyebrow">Agent plan</p>
          <h3>{task.plan.goal}</h3>
        </div>
        {task.status === "preview" && onRun ? (
          <button type="button" className="nc-agent-card__run" onClick={onRun}>
            Run plan
          </button>
        ) : (
          <span className={`nc-agent-card__pill nc-agent-card__pill--${task.status}`}>
            {task.status}
          </span>
        )}
      </div>

      {/* Steps */}
      <ol className="nc-agent-steps">
        {steps.map((step) => {
          const hasDetails = Boolean(step.result || step.error);
          const isExpanded = expandedSteps[step.step_number] ?? false;

          return (
            <li key={step.step_number} className={`nc-agent-step nc-agent-step--${step.status}`}>
              <button
                type="button"
                className="nc-agent-step__row"
                onClick={() => {
                  if (hasDetails) {
                    setExpandedSteps((previous) => ({
                      ...previous,
                      [step.step_number]: !isExpanded,
                    }));
                  }
                }}
              >
                <span className="nc-agent-step__number">{step.step_number}</span>
                <span className="nc-agent-step__description">{step.description}</span>
                <StatusIcon status={step.status} />
              </button>

              {/* Step result rendered as markdown */}
              {hasDetails && isExpanded ? (
                <div className="nc-agent-step__details">
                  {step.result ? (
                    <MarkdownContent
                      content={step.result}
                      className="nc-agent-step__result-md text-sm"
                    />
                  ) : null}
                  {step.error ? (
                    <p className="nc-agent-step__error">{step.error}</p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {/* Warning */}
      {task.warning ? <p className="nc-agent-warning">{task.warning}</p> : null}

      {/* Final summary rendered as markdown */}
      <div className="nc-agent-summary">
        <p className="nc-agent-summary__label">Final summary</p>
        <div className="nc-agent-summary__body">
          {task.summary || task.status === "running" ? (
            <div>
              {task.summary ? (
                <MarkdownContent content={task.summary} className="nc-agent-summary__md" />
              ) : null}
              {task.status === "running" ? (
                <span className="typing-cursor" aria-hidden="true" />
              ) : null}
            </div>
          ) : (
            <p className="nc-agent-summary__placeholder">
              Run the plan to stream the final summary here.
            </p>
          )}
        </div>
      </div>
    </section>
  );
} 