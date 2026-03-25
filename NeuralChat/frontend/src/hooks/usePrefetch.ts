import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { checkHealth, checkSearchStatus } from "../api";
import { getTemplates, getAllProjects } from "../api/projects";
import { getUsageStatus } from "../api/usage";
import type { RequestNamingContext } from "../api";

interface UsePrefetchOptions {
  getAuthToken?: () => Promise<string | null>;
  naming?: RequestNamingContext;
  enabled?: boolean;
}

export function usePrefetch(options?: UsePrefetchOptions): void {
  const queryClient = useQueryClient();
  const enabled = options?.enabled !== false;
  const getAuthToken = options?.getAuthToken;
  const userDisplayName = options?.naming?.userDisplayName;
  const sessionTitle = options?.naming?.sessionTitle;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void queryClient.prefetchQuery({
      queryKey: ["health"],
      queryFn: checkHealth,
    });
    void queryClient.prefetchQuery({
      queryKey: ["search-status"],
      queryFn: checkSearchStatus,
    });
    void queryClient.prefetchQuery({
      queryKey: ["project-templates"],
      queryFn: getTemplates,
    });
  }, [enabled, queryClient]);

  useEffect(() => {
    if (!enabled || !getAuthToken) {
      return;
    }

    let cancelled = false;

    async function prefetchAuthedQueries() {
      const authToken = await getAuthToken();
      if (!authToken || cancelled) {
        return;
      }
      const naming = {
        userDisplayName,
        sessionTitle,
      };

      await Promise.allSettled([
        queryClient.prefetchQuery({
          queryKey: ["projects", userDisplayName ?? ""],
          queryFn: () => getAllProjects(authToken, naming),
        }),
        queryClient.prefetchQuery({
          queryKey: ["usage-status", userDisplayName ?? ""],
          queryFn: () => getUsageStatus(authToken, naming),
        }),
      ]);
    }

    void prefetchAuthedQueries();
    return () => {
      cancelled = true;
    };
  }, [enabled, getAuthToken, queryClient, sessionTitle, userDisplayName]);
}
