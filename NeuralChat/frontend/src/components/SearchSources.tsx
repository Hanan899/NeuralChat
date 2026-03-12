import { useMemo, useState } from "react";

import type { SearchSource } from "../types";

interface SearchSourcesProps {
  sources: SearchSource[];
}

export function SearchSources({ sources }: SearchSourcesProps) {
  const [expanded, setExpanded] = useState(false);
  const visibleSources = useMemo(() => sources.slice(0, 5), [sources]);

  if (visibleSources.length === 0) {
    return null;
  }

  return (
    <section className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/60">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300"
      >
        <span>Sources</span>
        <span>{expanded ? "Hide" : "Show"}</span>
      </button>

      {expanded ? (
        <ul className="mt-2 space-y-2">
          {visibleSources.map((source, index) => (
            <li key={`${source.url}-${index}`} className="text-sm">
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-blue-700 underline dark:text-blue-300"
              >
                {source.title || source.url}
              </a>
              {source.snippet ? <p className="text-xs text-slate-500 dark:text-slate-400">{source.snippet}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
