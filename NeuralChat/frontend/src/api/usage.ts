import { getApiBaseUrl } from "../api";
import type { RequestNamingContext } from "../api";
import type { TodayUsageResponse, UsageLimitResponse, UsageStatusResponse, UsageSummary } from "../types";

function buildUsageHeaders(authToken: string, naming?: RequestNamingContext, includeJson = false): HeadersInit {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${authToken}`,
  };
  if (includeJson) {
    headers["Content-Type"] = "application/json";
  }
  if (naming?.userDisplayName?.trim()) {
    headers["X-User-Display-Name"] = naming.userDisplayName.trim();
  }
  if (naming?.sessionTitle?.trim()) {
    headers["X-Session-Title"] = naming.sessionTitle.trim();
  }
  return headers;
}

async function readUsageErrorMessage(response: Response, fallbackMessage: string): Promise<string> {
  const responseText = await response.text();
  if (!responseText) {
    return fallbackMessage;
  }

  try {
    const parsedPayload = JSON.parse(responseText) as { detail?: unknown; message?: unknown };
    if (typeof parsedPayload.detail === "string" && parsedPayload.detail.trim()) {
      return parsedPayload.detail.trim();
    }
    if (typeof parsedPayload.message === "string" && parsedPayload.message.trim()) {
      return parsedPayload.message.trim();
    }
  } catch {
    // Fall back to raw response text.
  }

  return responseText;
}

export async function getUsageSummary(
  days: number,
  authToken: string,
  naming?: RequestNamingContext
): Promise<UsageSummary> {
  const response = await fetch(`${getApiBaseUrl()}/api/usage/summary?days=${encodeURIComponent(String(days))}`, {
    headers: buildUsageHeaders(authToken, naming),
  });
  if (!response.ok) {
    throw new Error(await readUsageErrorMessage(response, "Failed to load usage summary."));
  }
  return (await response.json()) as UsageSummary;
}

export async function getTodayUsage(authToken: string, naming?: RequestNamingContext): Promise<TodayUsageResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/usage/today`, {
    headers: buildUsageHeaders(authToken, naming),
  });
  if (!response.ok) {
    throw new Error(await readUsageErrorMessage(response, "Failed to load today's usage."));
  }
  return (await response.json()) as TodayUsageResponse;
}

export async function getUsageLimit(authToken: string, naming?: RequestNamingContext): Promise<UsageLimitResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/usage/limit`, {
    headers: buildUsageHeaders(authToken, naming),
  });
  if (!response.ok) {
    throw new Error(await readUsageErrorMessage(response, "Failed to load daily limit."));
  }
  return (await response.json()) as UsageLimitResponse;
}

export async function getUsageStatus(authToken: string, naming?: RequestNamingContext): Promise<UsageStatusResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/usage/status`, {
    headers: buildUsageHeaders(authToken, naming),
  });
  if (!response.ok) {
    throw new Error(await readUsageErrorMessage(response, "Failed to load usage status."));
  }
  return (await response.json()) as UsageStatusResponse;
}

export async function updateUsageLimit(
  authToken: string,
  limits: {
    daily_limit_usd?: number;
    monthly_limit_usd?: number;
  },
  naming?: RequestNamingContext
): Promise<{ message: string; daily_limit_usd: number; monthly_limit_usd: number }> {
  const response = await fetch(`${getApiBaseUrl()}/api/usage/limit`, {
    method: "PATCH",
    headers: buildUsageHeaders(authToken, naming, true),
    body: JSON.stringify(limits),
  });
  if (!response.ok) {
    throw new Error(await readUsageErrorMessage(response, "Failed to update daily limit."));
  }
  return (await response.json()) as { message: string; daily_limit_usd: number; monthly_limit_usd: number };
}
