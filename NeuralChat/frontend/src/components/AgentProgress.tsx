import { useMemo, useState } from "react";

import type { AgentTaskState } from "../types";

interface AgentProgressProps {
  task: AgentTaskState;
  onRun?: () => void;
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

export function AgentProgress({ task, onRun }: AgentProgressProps) {
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({});

  const steps = useMemo(
    () =>
      task.plan.steps.map((step) => {
        const result = task.stepResults.find((item) => item.step_number === step.step_number);
        const status = result?.status ?? (task.runningStepNumber === step.step_number ? "running" : "pending");
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
          <span className={`nc-agent-card__pill nc-agent-card__pill--${task.status}`}>{task.status}</span>
        )}
      </div>

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
              {hasDetails && isExpanded ? (
                <div className="nc-agent-step__details">
                  {step.result ? <p>{step.result}</p> : null}
                  {step.error ? <p className="nc-agent-step__error">{step.error}</p> : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {task.warning ? <p className="nc-agent-warning">{task.warning}</p> : null}

      <div className="nc-agent-summary">
        <p className="nc-agent-summary__label">Final summary</p>
        <div className="nc-agent-summary__body">
          {task.summary || task.status === "running" ? (
            <p>
              {task.summary}
              {task.status === "running" ? <span className="typing-cursor" aria-hidden="true" /> : null}
            </p>
          ) : (
            <p className="nc-agent-summary__placeholder">Run the plan to stream the final summary here.</p>
          )}
        </div>
      </div>
    </section>
  );
}
