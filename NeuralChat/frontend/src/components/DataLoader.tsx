import type { ReactNode } from "react";

interface DataLoaderProps<TData> {
  data: TData | null | undefined;
  isLoading: boolean;
  isFetching?: boolean;
  isStale?: boolean;
  skeleton: ReactNode;
  emptyState?: ReactNode;
  children: (data: TData) => ReactNode;
}

export function DataLoader<TData>({
  data,
  isLoading,
  isFetching = false,
  isStale = false,
  skeleton,
  emptyState = null,
  children,
}: DataLoaderProps<TData>) {
  if (isLoading && !data) {
    return <>{skeleton}</>;
  }

  if (!data) {
    return <>{emptyState}</>;
  }

  return (
    <div className="nc-data-loader">
      {(isStale || isFetching) ? (
        <div className="nc-data-loader__status" aria-live="polite">
          {isStale ? <span className="nc-data-loader__stale-dot" /> : null}
          <span>{isFetching ? "Refreshing..." : "Showing cached data"}</span>
        </div>
      ) : null}
      {children(data)}
    </div>
  );
}
