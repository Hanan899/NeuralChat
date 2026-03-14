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
      <div
        className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-[1px] transition-opacity"
        onClick={onClose}
        aria-hidden={false}
      />
      <aside
        className="fixed right-0 top-0 z-50 h-full w-full max-w-md translate-x-0 transform border-l border-slate-300 bg-white/95 p-4 shadow-2xl transition-transform"
        aria-hidden={false}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="metric-code text-xs uppercase tracking-[0.14em] text-slate-500">Profile Memory</p>
            <h2 className="text-lg font-semibold text-slate-900">What NeuralChat knows about you</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>

        {errorText ? (
          <p className="mb-3 rounded-xl border border-red-300 bg-red-50 p-2 text-sm text-red-700">
            {errorText}
          </p>
        ) : null}

        <div className="space-y-2 overflow-y-auto pr-1">
          {isLoading ? (
            <>
              <div data-testid="memory-skeleton" className="h-10 animate-pulse rounded-xl bg-slate-200" />
              <div data-testid="memory-skeleton" className="h-10 animate-pulse rounded-xl bg-slate-200" />
              <div data-testid="memory-skeleton" className="h-10 animate-pulse rounded-xl bg-slate-200" />
            </>
          ) : factEntries.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 p-3 text-sm text-slate-600">
              No memory yet — start chatting!
            </p>
          ) : (
            factEntries.map(([key, value]) => (
              <div
                key={key}
                className="rounded-xl border border-slate-200 bg-white p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="metric-code text-xs uppercase tracking-[0.12em] text-slate-500">{key}</p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingKey(key);
                        setEditingValue(value);
                      }}
                      className="text-xs font-medium text-blue-700 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteKey(key)}
                      className="text-xs font-medium text-red-700 hover:underline"
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
                    className="mt-2 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-200"
                  />
                ) : (
                  <p className="mt-2 text-sm leading-relaxed text-slate-800">{formatFactForDisplay(value)}</p>
                )}
              </div>
            ))
          )}
        </div>

        <div className="mt-6 border-t border-slate-200 pt-4">
          <button
            type="button"
            onClick={handleClearAll}
            className="w-full rounded-xl bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            Clear All Memory
          </button>
        </div>
      </aside>
    </>
  );
}
