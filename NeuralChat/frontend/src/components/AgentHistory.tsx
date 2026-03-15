import { useEffect, useState } from "react";

import type { RequestNamingContext } from "../api";
import { getAgentHistory, getAgentTask } from "../api/agent";
import type { AgentStepResult, AgentTaskSummary } from "../types";

interface AgentHistoryProps {
  authToken: string;
  open: boolean;
  naming?: RequestNamingContext;
  onClose: () => void;
}

interface ExpandedTaskState {
  loading: boolean;
  log: AgentStepResult[];
  error: string;
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "done" || status === "completed"
      ? "#22c55e"
      : status === "failed"
      ? "#ef4444"
      : status === "running"
      ? "#d97706"
      : "var(--text-secondary)";
  return (
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: "999px",
        background: color,
        display: "inline-block",
        flexShrink: 0,
        boxShadow: `0 0 5px ${color}80`,
      }}
    />
  );
}

function StepRow({ entry, index }: { entry: AgentStepResult; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = Boolean(entry.result || entry.error);

  return (
    <div className="nc-ah-step">
      <button
        type="button"
        className="nc-ah-step__row"
        onClick={() => hasContent && setExpanded((v) => !v)}
        disabled={!hasContent}
      >
        <span className="nc-ah-step__num">{index + 1}</span>
        <span className="nc-ah-step__desc">{entry.description || `Step ${entry.step_number}`}</span>
        <span className="nc-ah-step__right">
          <StatusDot status={entry.status} />
          <span className="nc-ah-step__status">{entry.status}</span>
          {hasContent && (
            <svg
              viewBox="0 0 16 16" fill="none" width="11" height="11"
              style={{ transition: "transform 200ms", transform: expanded ? "rotate(180deg)" : "rotate(0deg)", color: "var(--text-secondary)" }}
            >
              <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </span>
      </button>
      {expanded && hasContent && (
        <div className="nc-ah-step__detail">
          {entry.error ? (
            <p className="nc-ah-step__error">{entry.error}</p>
          ) : (
            <p className="nc-ah-step__result">{entry.result}</p>
          )}
        </div>
      )}
    </div>
  );
}

// Module-level cache — survives panel close/reopen, cleared when auth changes
const _historyCache: { authToken: string; tasks: AgentTaskSummary[] } = { authToken: "", tasks: [] };

export function AgentHistory({ authToken, open, naming, onClose }: AgentHistoryProps) {
  const cached = _historyCache.authToken === authToken ? _historyCache.tasks : [];
  const [tasks, setTasks] = useState<AgentTaskSummary[]>(cached);
  const [loading, setLoading] = useState(cached.length === 0);
  const [loadError, setLoadError] = useState("");
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [taskDetails, setTaskDetails] = useState<Record<string, ExpandedTaskState>>({});

  // Module-level cache so history persists between opens without re-fetching
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    // If we already have tasks cached, show them instantly — just refresh silently
    if (tasks.length > 0) {
      setLoadError("");
    } else {
      setLoading(true);
      setLoadError("");
    }

    getAgentHistory(authToken, naming)
      .then((items) => {
        if (!cancelled) {
          _historyCache.authToken = authToken;
          _historyCache.tasks = items;
          setTasks(items);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          // Only show error if we have nothing cached to show
          if (tasks.length === 0) {
            setLoadError(err instanceof Error ? err.message : "Failed to load.");
          }
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleTask(planId: string) {
    if (expandedPlanId === planId) { setExpandedPlanId(null); return; }
    setExpandedPlanId(planId);
    if (taskDetails[planId]) return;

    setTaskDetails((prev) => ({ ...prev, [planId]: { loading: true, log: [], error: "" } }));
    try {
      const payload = await getAgentTask(authToken, planId, naming);
      setTaskDetails((prev) => ({ ...prev, [planId]: { loading: false, log: payload.log, error: "" } }));
    } catch (err) {
      setTaskDetails((prev) => ({
        ...prev,
        [planId]: { loading: false, log: [], error: err instanceof Error ? err.message : "Failed to load details." },
      }));
    }
  }

  if (!open) return null;

  const completedCount = tasks.filter((t) => (t as unknown as Record<string,unknown>)["status"] === "completed").length;

  return (
    <>
      <button type="button" className="nc-agent-history__backdrop" onClick={onClose} aria-label="Close" />

      <aside className="nc-ah-panel" aria-label="Agent history" data-testid="agent-history-panel">

        {/* ── Header ── */}
        <div className="nc-ah-header">
          <div className="nc-ah-header__left">
            <span className="nc-ah-header__icon">
              <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
                <rect x="7" y="8" width="10" height="8" rx="3" stroke="currentColor" strokeWidth="1.8"/>
                <path d="M12 4V8M9 18H15M8 21H16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                <circle cx="10" cy="12" r="0.8" fill="currentColor"/>
                <circle cx="14" cy="12" r="0.8" fill="currentColor"/>
              </svg>
            </span>
            <div>
              <h2 className="nc-ah-header__title">Agent History</h2>
              <p className="nc-ah-header__sub">
                {loading ? "Loading…" : `${tasks.length} task${tasks.length !== 1 ? "s" : ""}${completedCount > 0 ? ` · ${completedCount} completed` : ""}`}
              </p>
            </div>
          </div>
          <button type="button" className="nc-ah-header__close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" width="15" height="15">
              <path d="M7 7L17 17M17 7L7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* ── Body ── */}
        <div className="nc-ah-body">

          {/* Loading skeleton */}
          {loading ? (
            <div className="nc-ah-skeletons">
              {[1, 2, 3].map((i) => (
                <div key={i} className="nc-ah-skeleton" style={{ opacity: 1 - i * 0.2 }} />
              ))}
            </div>
          ) : loadError ? (
            <div className="nc-ah-error">
              <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M12 8V13M12 16H12.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
              <p>{loadError}</p>
            </div>
          ) : tasks.length === 0 ? (
            <div className="nc-ah-empty">
              <svg viewBox="0 0 48 48" fill="none" width="48" height="48">
                <rect x="14" y="18" width="20" height="16" rx="5" stroke="currentColor" strokeWidth="2" opacity="0.3"/>
                <path d="M24 10V18M20 36H28M18 42H30" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.3"/>
              </svg>
              <p className="nc-ah-empty__title">No agent tasks yet</p>
              <p className="nc-ah-empty__sub">Turn on Agent Mode and give me a goal to get started</p>
            </div>
          ) : (
            <div className="nc-ah-list">
              {tasks.map((task, idx) => {
                const details = taskDetails[task.plan_id];
                const isExpanded = expandedPlanId === task.plan_id;
                const taskStatus = String((task as unknown as Record<string,unknown>)["status"] ?? "");

                return (
                  <article key={task.plan_id} className={`nc-ah-item ${isExpanded ? "nc-ah-item--open" : ""}`}>

                    {/* Task row */}
                    <button
                      type="button"
                      className="nc-ah-item__btn"
                      onClick={() => void toggleTask(task.plan_id)}
                    >
                      {/* Index badge */}
                      <span className="nc-ah-item__idx">{tasks.length - idx}</span>

                      {/* Goal text */}
                      <span className="nc-ah-item__goal">{task.goal}</span>

                      {/* Right: steps + status + chevron */}
                      <span className="nc-ah-item__right">
                        <span className="nc-ah-item__steps">
                          {task.steps_count} step{task.steps_count !== 1 ? "s" : ""}
                        </span>
                        {taskStatus ? (
                          <span className={`nc-ah-item__pill nc-ah-item__pill--${taskStatus}`}>
                            {taskStatus}
                          </span>
                        ) : null}
                        <svg
                          viewBox="0 0 16 16" fill="none" width="12" height="12"
                          className={`nc-ah-item__chevron ${isExpanded ? "nc-ah-item__chevron--open" : ""}`}
                        >
                          <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </span>
                    </button>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="nc-ah-item__detail">
                        {details?.loading ? (
                          <div className="nc-ah-item__loading">
                            <span className="nc-thinking-dot" style={{ animationDelay: "0ms" }} />
                            <span className="nc-thinking-dot" style={{ animationDelay: "160ms" }} />
                            <span className="nc-thinking-dot" style={{ animationDelay: "320ms" }} />
                            <span style={{ marginLeft: 8, fontSize: 12, color: "var(--text-secondary)" }}>Loading steps…</span>
                          </div>
                        ) : details?.error ? (
                          <p className="nc-ah-step__error">{details.error}</p>
                        ) : details?.log.length === 0 ? (
                          <p style={{ fontSize: 13, color: "var(--text-secondary)", padding: "8px 0" }}>No step details available.</p>
                        ) : (
                          <div className="nc-ah-steps">
                            {details.log.map((entry, i) => (
                              <StepRow key={`${task.plan_id}-${entry.step_number}`} entry={entry} index={i} />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}