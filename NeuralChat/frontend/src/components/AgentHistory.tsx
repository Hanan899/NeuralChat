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

export function AgentHistory({ authToken, open, naming, onClose }: AgentHistoryProps) {
  const [tasks, setTasks] = useState<AgentTaskSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [taskDetails, setTaskDetails] = useState<Record<string, ExpandedTaskState>>({});

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError("");

    getAgentHistory(authToken, naming)
      .then((historyItems) => {
        if (!cancelled) {
          setTasks(historyItems);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Failed to load agent history.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authToken, naming, open]);

  async function toggleTask(planId: string) {
    if (expandedPlanId === planId) {
      setExpandedPlanId(null);
      return;
    }

    setExpandedPlanId(planId);
    if (taskDetails[planId]) {
      return;
    }

    setTaskDetails((previous) => ({
      ...previous,
      [planId]: { loading: true, log: [], error: "" },
    }));

    try {
      const payload = await getAgentTask(authToken, planId, naming);
      setTaskDetails((previous) => ({
        ...previous,
        [planId]: { loading: false, log: payload.log, error: "" },
      }));
    } catch (error) {
      setTaskDetails((previous) => ({
        ...previous,
        [planId]: {
          loading: false,
          log: [],
          error: error instanceof Error ? error.message : "Failed to load task details.",
        },
      }));
    }
  }

  if (!open) {
    return null;
  }

  return (
    <>
      <button type="button" className="nc-agent-history__backdrop" onClick={onClose} aria-label="Close agent history" />
      <aside className="nc-agent-history" aria-label="Agent history" data-testid="agent-history-panel">
        <div className="nc-agent-history__header">
          <div>
            <p className="nc-agent-history__eyebrow">Agent history</p>
            <h2>Past agent tasks</h2>
          </div>
          <button type="button" className="nc-agent-history__close" onClick={onClose}>
            Close
          </button>
        </div>

        {loading ? <div className="nc-agent-history__skeleton" /> : null}
        {loadError ? <p className="nc-error">{loadError}</p> : null}
        {!loading && !loadError && tasks.length === 0 ? (
          <p className="nc-agent-history__empty">No agent tasks yet — turn on Agent Mode and give me a goal!</p>
        ) : null}

        <div className="nc-agent-history__list">
          {tasks.map((task) => {
            const details = taskDetails[task.plan_id];
            const isExpanded = expandedPlanId === task.plan_id;
            return (
              <article key={task.plan_id} className="nc-agent-history__item">
                <button type="button" className="nc-agent-history__item-button" onClick={() => void toggleTask(task.plan_id)}>
                  <span className="nc-agent-history__goal">{task.goal}</span>
                  <span className="nc-agent-history__meta">{task.steps_count} steps</span>
                </button>
                {isExpanded ? (
                  <div className="nc-agent-history__details">
                    {details?.loading ? <p>Loading task details...</p> : null}
                    {details?.error ? <p className="nc-error">{details.error}</p> : null}
                    {details?.log.map((entry) => (
                      <div key={`${task.plan_id}-${entry.step_number}`} className="nc-agent-history__log-row">
                        <strong>Step {entry.step_number}</strong>
                        <span>{entry.status}</span>
                        <p>{entry.result || entry.error || "No result."}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </aside>
    </>
  );
}
