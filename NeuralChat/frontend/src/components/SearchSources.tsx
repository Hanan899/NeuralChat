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
    <section className="nc-sources">
      <button type="button" onClick={() => setExpanded((value) => !value)} className="nc-sources__toggle">
        <span>Sources</span>
        <span>{expanded ? "Hide" : "Show"}</span>
      </button>

      {expanded ? (
        <ul className="nc-sources__list">
          {visibleSources.map((source, index) => (
            <li key={`${source.url}-${index}`}>
              <a href={source.url} target="_blank" rel="noreferrer">
                {source.title || source.url}
              </a>
              {source.snippet ? <p>{source.snippet}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
