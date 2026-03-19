import { KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";

import type { RequestNamingContext } from "../api";
import { getBrainLog, getProjectMemory, resetProjectBrain, updateProjectMemoryFact } from "../api/projects";
import type { ProjectBrainLogEntry, ProjectMemoryResponse } from "../types/project";

type ProjectBrainPanelProps = {
  authToken: string;
  getAuthToken?: () => Promise<string | null>;
  projectId: string;
  template: string;
  naming?: RequestNamingContext;
  initialData?: ProjectMemoryResponse | null;
};

type ProjectBrainState = ProjectMemoryResponse;

const EMPTY_COMPLETENESS = {
  percentage: 0,
  filled_keys: [],
  missing_keys: [],
  suggestion: "",
};

function formatLabel(memoryKey: string) {
  return memoryKey
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatLearnedKeys(extractedFacts: Record<string, string>) {
  const factKeys = Object.keys(extractedFacts);
  if (factKeys.length === 0) {
    return "No new facts";
  }
  return factKeys.map(formatLabel).join(", ");
}

function isInvalidAuthError(error: unknown) {
  return error instanceof Error && error.message.trim().toLowerCase().includes("invalid authentication token");
}

export function ProjectBrainPanel({
  authToken,
  getAuthToken,
  projectId,
  template,
  naming,
  initialData,
}: ProjectBrainPanelProps) {
  const [brainState, setBrainState] = useState<ProjectBrainState>(
    initialData ?? { memory: {}, completeness: EMPTY_COMPLETENESS }
  );
  const [brainLog, setBrainLog] = useState<ProjectBrainLogEntry[]>([]);
  const [isLogOpen, setIsLogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(!initialData);
  const [errorText, setErrorText] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isRetryingAuth, setIsRetryingAuth] = useState(false);

  const resolveAuthToken = useCallback(async (forceFresh = false) => {
    if (getAuthToken) {
      for (let attemptNumber = 0; attemptNumber < 3; attemptNumber += 1) {
        const nextToken = ((await getAuthToken()) ?? "").trim();
        if (nextToken) {
          return nextToken;
        }
        if (attemptNumber < 2) {
          await new Promise((resolve) => window.setTimeout(resolve, 200));
        }
      }
    }

    if (!forceFresh && authToken.trim()) {
      return authToken.trim();
    }

    return "";
  }, [authToken, getAuthToken]);

  const runWithProjectToken = useCallback(async <T,>(
    task: (resolvedAuthToken: string) => Promise<T>
  ): Promise<T> => {
    const firstToken = await resolveAuthToken();
    if (!firstToken) {
      throw new Error("We couldn't confirm your session yet. Please wait a second and try again.");
    }

    try {
      return await task(firstToken);
    } catch (error) {
      if (!isInvalidAuthError(error) || !getAuthToken) {
        throw error;
      }

      setIsRetryingAuth(true);
      try {
        const refreshedToken = await resolveAuthToken(true);
        if (!refreshedToken) {
          throw new Error("We couldn't refresh your session. Please reopen the project and try again.");
        }
        return await task(refreshedToken);
      } finally {
        setIsRetryingAuth(false);
      }
    }
  }, [getAuthToken, resolveAuthToken]);

  const loadProjectBrain = useCallback(async () => {
    setIsLoading(true);
    setErrorText("");
    try {
      const [memoryPayload, brainLogPayload] = await runWithProjectToken((resolvedAuthToken) =>
        Promise.all([
          getProjectMemory(resolvedAuthToken, projectId, naming),
          getBrainLog(resolvedAuthToken, projectId, naming),
        ])
      );
      setBrainState(memoryPayload);
      setBrainLog(brainLogPayload.log);
    } catch (error) {
      setErrorText(
        error instanceof Error ? error.message : "Failed to load Project Brain."
      );
    } finally {
      setIsLoading(false);
    }
  }, [naming, projectId, runWithProjectToken]);

  useEffect(() => {
    setBrainState(initialData ?? { memory: {}, completeness: EMPTY_COMPLETENESS });
  }, [initialData]);

  useEffect(() => {
    void loadProjectBrain();
    const intervalId = window.setInterval(() => {
      void loadProjectBrain();
    }, 30_000);
    return () => window.clearInterval(intervalId);
  }, [loadProjectBrain]);

  const filledRows = useMemo(
    () =>
      brainState.completeness.filled_keys
        .map((memoryKey) => ({
          key: memoryKey,
          label: formatLabel(memoryKey),
          value: brainState.memory[memoryKey] ?? "",
        }))
        .filter((row) => row.value),
    [brainState]
  );

  async function saveEditedFact() {
    if (!editingKey || !editingValue.trim()) {
      return;
    }

    setIsSaving(true);
    setErrorText("");
    try {
      const response = await runWithProjectToken((resolvedAuthToken) =>
        updateProjectMemoryFact(resolvedAuthToken, projectId, editingKey, editingValue.trim(), naming)
      );
      setBrainState((previous) => ({
        memory: response.memory,
        completeness: {
          ...previous.completeness,
          filled_keys: previous.completeness.filled_keys.includes(editingKey)
            ? previous.completeness.filled_keys
            : [...previous.completeness.filled_keys, editingKey],
          missing_keys: previous.completeness.missing_keys.filter((memoryKey) => memoryKey !== editingKey),
          percentage: previous.completeness.missing_keys.includes(editingKey)
            ? Math.round(((previous.completeness.filled_keys.length + 1) / Math.max(1, previous.completeness.filled_keys.length + previous.completeness.missing_keys.length)) * 100)
            : previous.completeness.percentage,
          suggestion: previous.completeness.missing_keys.filter((memoryKey) => memoryKey !== editingKey).length
            ? previous.completeness.suggestion
            : "",
        },
      }));
      setEditingKey(null);
      setEditingValue("");
      await loadProjectBrain();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to update Project Brain.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleResetBrain() {
    const confirmed = window.confirm("Reset Project Brain? This clears all learned memory and recent learning history.");
    if (!confirmed) {
      return;
    }

    setIsResetting(true);
    setErrorText("");
    try {
      await runWithProjectToken((resolvedAuthToken) =>
        resetProjectBrain(resolvedAuthToken, projectId, naming)
      );
      setBrainState({ memory: {}, completeness: template === "custom" ? { ...EMPTY_COMPLETENESS, percentage: 100 } : EMPTY_COMPLETENESS });
      setBrainLog([]);
      setEditingKey(null);
      setEditingValue("");
      await loadProjectBrain();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to reset Project Brain.");
    } finally {
      setIsResetting(false);
    }
  }

  function handleEditKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void saveEditedFact();
    }
    if (event.key === "Escape") {
      setEditingKey(null);
      setEditingValue("");
    }
  }

  const hasKnownFacts = filledRows.length > 0;
  const isCustomTemplate = template === "custom";
  const memoryPercentageLabel = isCustomTemplate && !hasKnownFacts
    ? "Open-ended"
    : `${brainState.completeness.percentage}%`;

  return (
    <section className="nc-project-panel nc-project-brain-panel" data-testid="project-brain-panel">
      <div className="nc-project-panel__header">
        <h3>
          <span className="nc-project-panel__title-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M12 5.25C9.38 5.25 7.25 7.38 7.25 10C7.25 11.28 7.76 12.44 8.58 13.29C8.95 13.67 9.18 14.18 9.18 14.71V15.4C9.18 15.95 9.63 16.4 10.18 16.4H13.82C14.37 16.4 14.82 15.95 14.82 15.4V14.71C14.82 14.18 15.05 13.67 15.42 13.29C16.24 12.44 16.75 11.28 16.75 10C16.75 7.38 14.62 5.25 12 5.25Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M10.25 19.05H13.75" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M10.85 21H13.15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </span>
          Project Brain
        </h3>
        <button type="button" className="nc-button nc-button--ghost" onClick={() => void loadProjectBrain()} disabled={isLoading || isRetryingAuth}>
          {isRetryingAuth ? "Reconnecting…" : "Refresh"}
        </button>
      </div>

      {isLoading ? <div className="nc-project-panel__empty">Loading Project Brain…</div> : null}

      {!isLoading ? (
        <div className="nc-project-brain-panel__content">
          <div className="nc-project-brain-panel__progress-wrap">
            <div className="nc-project-brain-panel__progress-meta">
              <div className="nc-project-brain-panel__progress-copy">
                <span>Memory completeness</span>
                <small>
                  {isCustomTemplate
                    ? "Custom projects learn organically from the details you share."
                    : "Project Brain keeps track of the key facts this workspace depends on."}
                </small>
              </div>
              <strong>{memoryPercentageLabel}</strong>
            </div>
            <div className="nc-project-brain-panel__progress" aria-label={`Memory completeness ${brainState.completeness.percentage}%`}>
              <div style={{ width: `${brainState.completeness.percentage}%` }} />
            </div>
          </div>

          {brainState.completeness.suggestion ? (
            <div className="nc-project-brain-panel__suggestion">
              <strong>Suggestion</strong>
              <span>{brainState.completeness.suggestion}</span>
            </div>
          ) : null}

          <div className="nc-project-brain-panel__section">
            <h4>What I know</h4>
            {filledRows.length === 0 ? (
              <div className="nc-project-brain-panel__empty-state">
                <strong>{isCustomTemplate ? "This workspace is ready to learn." : "Project Brain is still learning this workspace."}</strong>
                <span>
                  {isCustomTemplate
                    ? "Start chatting inside the project and NeuralChat will retain the useful context it learns over time."
                    : "As you discuss the project, NeuralChat will capture the important facts and reuse them in future chats."}
                </span>
              </div>
            ) : (
              <div className="nc-project-memory-list">
                {filledRows.map((row) => (
                  <div key={row.key} className="nc-project-memory-row nc-project-brain-panel__fact-row">
                    <div className="nc-project-brain-panel__fact-copy">
                      <strong>{row.label}</strong>
                      {editingKey === row.key ? (
                        <input
                          aria-label={`Edit ${row.label}`}
                          value={editingValue}
                          onChange={(event) => setEditingValue(event.target.value)}
                          onKeyDown={handleEditKeyDown}
                          autoFocus
                        />
                      ) : (
                        <span>{row.value}</span>
                      )}
                    </div>
                    <div className="nc-project-brain-panel__fact-actions">
                      {editingKey === row.key ? (
                        <button type="button" className="nc-button nc-button--ghost" onClick={() => void saveEditedFact()} disabled={isSaving}>
                          Save
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="nc-button nc-button--ghost"
                          aria-label={`Edit ${row.label}`}
                          onClick={() => {
                            setEditingKey(row.key);
                            setEditingValue(row.value);
                          }}
                        >
                          ✏️
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {brainState.completeness.missing_keys.length > 0 ? (
            <div className="nc-project-brain-panel__section">
              <h4>Still learning</h4>
              <div className="nc-project-brain-panel__missing-list">
                {brainState.completeness.missing_keys.map((memoryKey) => (
                  <div key={memoryKey} className="nc-project-brain-panel__missing-item">
                    <span className="nc-project-brain-panel__missing-dot" aria-hidden="true">○</span>
                    <span>{formatLabel(memoryKey)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="nc-project-brain-panel__actions">
            <button type="button" className="nc-button nc-button--ghost nc-button--danger" onClick={() => void handleResetBrain()} disabled={isResetting}>
              {isResetting ? "Resetting…" : "Reset Project Brain"}
            </button>
          </div>

          <div className="nc-project-brain-panel__log">
            <button
              type="button"
              className="nc-project-brain-panel__log-toggle"
              onClick={() => setIsLogOpen((value) => !value)}
            >
              {isLogOpen ? "▼" : "▶"} What the AI learned recently
            </button>
            {isLogOpen ? (
              brainLog.length === 0 ? (
                <div className="nc-project-panel__empty">No recent learning events yet.</div>
              ) : (
                <div className="nc-project-brain-panel__log-list">
                  {brainLog.map((entry) => (
                    <div key={`${entry.session_id}-${entry.timestamp}`} className="nc-project-brain-panel__log-entry">
                      <strong>{new Date(entry.timestamp).toLocaleDateString()}</strong>
                      <span>Learned: {formatLearnedKeys(entry.extracted_facts)}</span>
                    </div>
                  ))}
                </div>
              )
            ) : null}
          </div>

          {errorText ? <p className="nc-project-brain-panel__error">{errorText}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
