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
            <li key={`${source.url || source.filename || source.title}-${index}`}>
              {source.url ? (
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  {source.title || source.url}
                </a>
              ) : (
                <strong>{source.title || source.filename || "Uploaded file"}</strong>
              )}
              {source.source_type === "file" && source.chunk_index ? (
                <span className="nc-sources__meta">Chunk {source.chunk_index}</span>
              ) : null}
              {source.snippet ? <p>{source.snippet}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
