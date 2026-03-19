import { useEffect, useMemo, useState } from "react";

import { deleteMemory, getMe, patchMemory } from "../api";
import type { RequestNamingContext } from "../api";

interface MemoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  getAuthToken: () => Promise<string | null>;
  naming?: RequestNamingContext;
}

const HIDDEN_PROFILE_KEYS = new Set(["user_id", "display_name", "updated_at"]);

function normalizeFactValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeFacts(profile: Record<string, unknown> | null | undefined): Record<string, string> {
  if (!profile) {
    return {};
  }
  const normalized: Record<string, string> = {};
  for (const [factKey, factValue] of Object.entries(profile)) {
    if (HIDDEN_PROFILE_KEYS.has(factKey)) {
      continue;
    }
    normalized[factKey] = normalizeFactValue(factValue);
  }
  return normalized;
}

function formatFactForDisplay(value: string): string {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return "";
  }
  if (!(trimmedValue.startsWith("{") || trimmedValue.startsWith("["))) {
    return value;
  }

  try {
    const parsedValue = JSON.parse(trimmedValue);
    if (Array.isArray(parsedValue)) {
      return parsedValue.map((item) => String(item)).join(", ");
    }
    if (parsedValue && typeof parsedValue === "object") {
      const entries = Object.entries(parsedValue as Record<string, unknown>);
      return entries.map(([key, entryValue]) => `${key}: ${String(entryValue)}`).join(" | ");
    }
    return value;
  } catch {
    return value;
  }
}

export function MemoryPanel({ isOpen, onClose, getAuthToken, naming }: MemoryPanelProps) {
  const [facts, setFacts] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const factEntries = useMemo(() => Object.entries(facts).sort(([left], [right]) => left.localeCompare(right)), [facts]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let isMounted = true;
    async function fetchMemory() {
      setIsLoading(true);
      setErrorText("");
      try {
        const authToken = await getAuthToken();
        if (!authToken) {
          throw new Error("Authentication token unavailable. Please sign in again.");
        }
        const response = await getMe(authToken, naming);
        if (isMounted) {
          setFacts(normalizeFacts(response.profile));
        }
      } catch (error) {
        if (isMounted) {
          setErrorText(error instanceof Error ? error.message : "Failed to load memory.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    fetchMemory();
    return () => {
      isMounted = false;
    };
  }, [getAuthToken, isOpen, naming]);

  async function saveFact(key: string, value: string) {
    const authToken = await getAuthToken();
    if (!authToken) {
      throw new Error("Authentication token unavailable. Please sign in again.");
    }
    const response = await patchMemory(authToken, key, value, naming);
    setFacts(normalizeFacts(response.profile));
  }

  async function handleClearAll() {
    setErrorText("");
    try {
      const authToken = await getAuthToken();
      if (!authToken) {
        throw new Error("Authentication token unavailable. Please sign in again.");
      }
      await deleteMemory(authToken, naming);
      setFacts({});
      setEditingKey(null);
      setEditingValue("");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to clear memory.");
    }
  }

  async function handleDeleteKey(key: string) {
    setErrorText("");
    try {
      await saveFact(key, "");
      if (editingKey === key) {
        setEditingKey(null);
        setEditingValue("");
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to delete memory key.");
    }
  }

  async function handleEditSubmit(key: string) {
    setErrorText("");
    try {
      await saveFact(key, editingValue.trim());
      setEditingKey(null);
      setEditingValue("");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to update memory key.");
    }
  }

  if (!isOpen) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        className="nc-memory-panel__backdrop"
        onClick={onClose}
        aria-label="Close memory panel"
      />
      <aside className="nc-memory-panel" aria-hidden={false} aria-label="Profile memory panel">
        <div className="nc-memory-panel__header">
          <div className="nc-memory-panel__header-copy">
            <p className="nc-memory-panel__eyebrow">Profile Memory</p>
            <h2>What NeuralChat knows about you</h2>
          </div>
          <button type="button" onClick={onClose} className="nc-memory-panel__close">
            Close
          </button>
        </div>

        {errorText ? (
          <p className="nc-memory-panel__error">{errorText}</p>
        ) : null}

        <div className="nc-memory-panel__body">
          {isLoading ? (
            <>
              <div data-testid="memory-skeleton" className="nc-memory-panel__skeleton" />
              <div data-testid="memory-skeleton" className="nc-memory-panel__skeleton" />
              <div data-testid="memory-skeleton" className="nc-memory-panel__skeleton" />
            </>
          ) : factEntries.length === 0 ? (
            <p className="nc-memory-panel__empty">No memory yet — start chatting!</p>
          ) : (
            factEntries.map(([key, value]) => (
              <div key={key} className="nc-memory-panel__fact">
                <div className="nc-memory-panel__fact-header">
                  <p className="nc-memory-panel__fact-key">{key}</p>
                  <div className="nc-memory-panel__fact-actions">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingKey(key);
                        setEditingValue(value);
                      }}
                      className="nc-memory-panel__action"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteKey(key)}
                      className="nc-memory-panel__action nc-memory-panel__action--danger"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {editingKey === key ? (
                  <input
                    autoFocus
                    value={editingValue}
                    onChange={(event) => setEditingValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void handleEditSubmit(key);
                      }
                      if (event.key === "Escape") {
                        setEditingKey(null);
                        setEditingValue("");
                      }
                    }}
                    className="nc-memory-panel__input"
                  />
                ) : (
                  <p className="nc-memory-panel__fact-value">{formatFactForDisplay(value)}</p>
                )}
              </div>
            ))
          )}
        </div>

        <div className="nc-memory-panel__footer">
          <button
            type="button"
            onClick={handleClearAll}
            className="nc-memory-panel__clear"
          >
            Clear All Memory
          </button>
        </div>
      </aside>
    </>
  );
}
