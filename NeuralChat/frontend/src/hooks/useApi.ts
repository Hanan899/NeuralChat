import { useQuery, type QueryKey, type UseQueryOptions, type UseQueryResult } from "@tanstack/react-query";

import {
  buildProtectedHeaders,
  getApiBaseUrl,
  readErrorMessage,
  type RequestNamingContext,
} from "../api";

type ApiQueryOptions<TData> = Omit<UseQueryOptions<TData, Error, TData, QueryKey>, "queryKey" | "queryFn"> & {
  authToken?: string | null;
  naming?: RequestNamingContext;
  queryFn?: () => Promise<TData>;
  requestInit?: RequestInit;
};

function resolveUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  const normalizedUrl = url.startsWith("/") ? url : `/${url}`;
  return `${getApiBaseUrl()}${normalizedUrl}`;
}

async function fetchJson<TData>(url: string, options?: ApiQueryOptions<TData>): Promise<TData> {
  const headers = new Headers(options?.requestInit?.headers ?? {});
  if (options?.authToken) {
    const protectedHeaders = buildProtectedHeaders(options.authToken, options.naming);
    const normalizedHeaders = protectedHeaders instanceof Headers ? protectedHeaders : new Headers(protectedHeaders);
    normalizedHeaders.forEach((value, key) => headers.set(key, value));
  }

  const response = await fetch(resolveUrl(url), {
    ...options?.requestInit,
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Request failed."));
  }

  return (await response.json()) as TData;
}

export function useApiQuery<TData>(
  key: string[],
  url: string,
  options?: ApiQueryOptions<TData>
): {
  data: TData | undefined;
  isLoading: boolean;
  isStale: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: UseQueryResult<TData, Error>["refetch"];
} {
  const { queryFn, ...restOptions } = options ?? {};
  const query = useQuery<TData, Error>({
    ...restOptions,
    queryKey: key,
    queryFn: queryFn ?? (() => fetchJson<TData>(url, options)),
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    isStale: query.isStale,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}
