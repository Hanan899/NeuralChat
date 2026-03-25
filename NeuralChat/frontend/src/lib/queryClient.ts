import { QueryClient } from "@tanstack/react-query";

function isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const normalizedMessage = error.message.trim().toLowerCase();
  return (
    normalizedMessage.includes("failed to fetch") ||
    normalizedMessage.includes("network") ||
    normalizedMessage.includes("load failed") ||
    normalizedMessage.includes("timeout")
  );
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => failureCount < 2 && isRetryableNetworkError(error),
    },
  },
});
