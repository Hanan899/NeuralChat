import { useEffect, useMemo, useState } from "react";

import { deleteMemory, getMe, patchMemory } from "../api";

interface MemoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  getAuthToken: () => Promise<string | null>;
}

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
    normalized[factKey] = normalizeFactValue(factValue);
  }
  return normalized;
}

export function MemoryPanel({ isOpen, onClose, getAuthToken }: MemoryPanelProps) {
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
        const response = await getMe(authToken);
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
  }, [getAuthToken, isOpen]);

  async function saveFact(key: string, value: string) {
    const authToken = await getAuthToken();
    if (!authToken) {
      throw new Error("Authentication token unavailable. Please sign in again.");
    }
    const response = await patchMemory(authToken, key, value);
    setFacts(normalizeFacts(response.profile));
  }

  async function handleClearAll() {
    setErrorText("");
    try {
      const authToken = await getAuthToken();
      if (!authToken) {
        throw new Error("Authentication token unavailable. Please sign in again.");
      }
      await deleteMemory(authToken);
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
      <div
        className="fixed inset-0 z-40 bg-black/30 transition-opacity opacity-100"
        onClick={onClose}
        aria-hidden={false}
      />
      <aside
        className="fixed right-0 top-0 z-50 h-full w-full max-w-md translate-x-0 transform border-l border-slate-300 bg-white p-4 shadow-xl transition-transform dark:border-slate-700 dark:bg-slate-900"
        aria-hidden={false}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">What NeuralChat knows about you</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Close
          </button>
        </div>

        {errorText ? (
          <p className="mb-3 rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {errorText}
          </p>
        ) : null}

        <div className="space-y-2">
          {isLoading ? (
            <>
              <div data-testid="memory-skeleton" className="h-10 animate-pulse rounded-md bg-slate-200 dark:bg-slate-700" />
              <div data-testid="memory-skeleton" className="h-10 animate-pulse rounded-md bg-slate-200 dark:bg-slate-700" />
              <div data-testid="memory-skeleton" className="h-10 animate-pulse rounded-md bg-slate-200 dark:bg-slate-700" />
            </>
          ) : factEntries.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-300 p-3 text-sm text-slate-600 dark:border-slate-600 dark:text-slate-300">
              No memory yet — start chatting!
            </p>
          ) : (
            factEntries.map(([key, value]) => (
              <div
                key={key}
                className="rounded-md border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800/70"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{key}</p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingKey(key);
                        setEditingValue(value);
                      }}
                      className="text-xs text-blue-700 hover:underline dark:text-blue-300"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteKey(key)}
                      className="text-xs text-red-700 hover:underline dark:text-red-300"
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
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  />
                ) : (
                  <p className="mt-1 text-sm text-slate-800 dark:text-slate-100">{value}</p>
                )}
              </div>
            ))
          )}
        </div>

        <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-700">
          <button
            type="button"
            onClick={handleClearAll}
            className="w-full rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Clear All Memory
          </button>
        </div>
      </aside>
    </>
  );
}
