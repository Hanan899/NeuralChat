import type { RequestNamingContext } from "../api";
import { buildProtectedHeaders, getApiBaseUrl, readErrorMessage } from "../api";
import type {
  AppFeaturePermission,
  AppRole,
  InviteMemberResponse,
  UserAccessProfile,
  UserUsageSummary,
} from "../access";

const API_BASE_URL = getApiBaseUrl();

export async function getMembers(authToken: string, naming?: RequestNamingContext): Promise<UserAccessProfile[]> {
  const response = await fetch(`${API_BASE_URL}/api/members`, {
    headers: buildProtectedHeaders(authToken, naming),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to load members."));
  }
  const payload = (await response.json()) as { members?: UserAccessProfile[] };
  return Array.isArray(payload.members) ? payload.members : [];
}

export async function getMemberUsage(
  authToken: string,
  userId: string,
  naming?: RequestNamingContext
): Promise<UserUsageSummary | null> {
  const response = await fetch(`${API_BASE_URL}/api/members/${encodeURIComponent(userId)}/usage`, {
    headers: buildProtectedHeaders(authToken, naming),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to load member usage."));
  }
  const payload = (await response.json()) as { usage?: UserUsageSummary | null };
  return payload.usage ?? null;
}

export async function inviteMember(
  authToken: string,
  payload: { email: string; role: AppRole },
  naming?: RequestNamingContext
): Promise<InviteMemberResponse> {
  const response = await fetch(`${API_BASE_URL}/api/members/invite`, {
    method: "POST",
    headers: buildProtectedHeaders(authToken, naming, true),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to invite member."));
  }
  return (await response.json()) as InviteMemberResponse;
}

export async function updateMemberRole(
  authToken: string,
  userId: string,
  role: AppRole,
  naming?: RequestNamingContext
): Promise<UserAccessProfile> {
  const response = await fetch(`${API_BASE_URL}/api/members/${encodeURIComponent(userId)}/role`, {
    method: "PATCH",
    headers: buildProtectedHeaders(authToken, naming, true),
    body: JSON.stringify({ role }),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to update member role."));
  }
  return (await response.json()) as UserAccessProfile;
}

export async function updateMemberFeatures(
  authToken: string,
  userId: string,
  featureOverrides: Partial<Record<AppFeaturePermission, boolean>>,
  naming?: RequestNamingContext
): Promise<UserAccessProfile> {
  const response = await fetch(`${API_BASE_URL}/api/members/${encodeURIComponent(userId)}/features`, {
    method: "PATCH",
    headers: buildProtectedHeaders(authToken, naming, true),
    body: JSON.stringify({ feature_overrides: featureOverrides }),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to update member features."));
  }
  return (await response.json()) as UserAccessProfile;
}

export async function updateMemberUsageLimit(
  authToken: string,
  userId: string,
  limits: { daily_limit_usd?: number; monthly_limit_usd?: number },
  naming?: RequestNamingContext
): Promise<UserAccessProfile> {
  const response = await fetch(`${API_BASE_URL}/api/members/${encodeURIComponent(userId)}/usage-limit`, {
    method: "PATCH",
    headers: buildProtectedHeaders(authToken, naming, true),
    body: JSON.stringify(limits),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to update member usage limits."));
  }
  return (await response.json()) as UserAccessProfile;
}

export async function deleteMember(authToken: string, userId: string, naming?: RequestNamingContext): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/members/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: buildProtectedHeaders(authToken, naming),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to remove member."));
  }
}
