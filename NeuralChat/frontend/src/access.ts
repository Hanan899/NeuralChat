export type AppRole = "owner" | "member" | "user";

export type AppFeaturePermission =
  | "chat:create"
  | "project:create"
  | "project:delete"
  | "agent:run"
  | "file:upload"
  | "memory:read"
  | "memory:write"
  | "usage:read"
  | "usage:manage"
  | "billing:manage";

export const APP_ROLES: AppRole[] = ["owner", "member", "user"];
export const APP_FEATURES: AppFeaturePermission[] = [
  "chat:create",
  "project:create",
  "project:delete",
  "agent:run",
  "file:upload",
  "memory:read",
  "memory:write",
  "usage:read",
  "usage:manage",
  "billing:manage",
];

export const ROLE_LABELS: Record<AppRole, string> = {
  owner: "Owner",
  member: "Member",
  user: "User",
};

export const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  owner: "Full access. Can manage users, features, and usage limits across the app.",
  member: "Workspace contributor. Can chat, create projects, upload files, and use agent workflows.",
  user: "Light access. Can chat and use the app with a smaller feature set by default.",
};

export const ROLE_COLORS: Record<AppRole, { bg: string; text: string; border: string }> = {
  owner: { bg: "rgba(124, 92, 255, 0.14)", text: "#5b45d6", border: "rgba(124, 92, 255, 0.28)" },
  member: { bg: "rgba(43, 182, 115, 0.14)", text: "#1e8b55", border: "rgba(43, 182, 115, 0.24)" },
  user: { bg: "rgba(107, 122, 153, 0.12)", text: "#55627f", border: "rgba(107, 122, 153, 0.24)" },
};

export const ROLE_DEFAULT_FEATURES: Record<AppRole, AppFeaturePermission[]> = {
  owner: [...APP_FEATURES],
  member: [
    "chat:create",
    "project:create",
    "project:delete",
    "agent:run",
    "file:upload",
    "memory:read",
    "memory:write",
    "usage:read",
  ],
  user: ["chat:create", "usage:read"],
};

export interface EffectiveUsageLimits {
  daily_limit_usd: number;
  monthly_limit_usd: number;
}

export interface EffectiveAccessProfile {
  role: AppRole;
  role_label: string;
  is_owner: boolean;
  feature_overrides: Partial<Record<AppFeaturePermission, boolean>>;
  effective_features: AppFeaturePermission[];
  usage_limits: EffectiveUsageLimits;
  email?: string | null;
  display_name?: string | null;
  seeded_owner?: boolean;
}

export interface UserUsageSummary {
  daily_spent_usd: number;
  monthly_spent_usd: number;
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
}

export interface UserAccessProfile {
  user_id: string;
  display_name: string;
  email?: string | null;
  last_active_at?: string | null;
  role: AppRole;
  role_label: string;
  feature_overrides: Partial<Record<AppFeaturePermission, boolean>>;
  effective_features: AppFeaturePermission[];
  usage_limits: EffectiveUsageLimits;
  usage?: UserUsageSummary | null;
  seeded_owner?: boolean;
}

export interface InviteMemberRequest {
  email: string;
  role: AppRole;
}

export interface InviteMemberResponse {
  email: string;
  role: AppRole;
  invitation_id?: string | null;
  status?: string | null;
}

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && APP_ROLES.includes(value as AppRole);
}

export function isAppFeaturePermission(value: unknown): value is AppFeaturePermission {
  return typeof value === "string" && APP_FEATURES.includes(value as AppFeaturePermission);
}

export function buildFeatureOverridePayload(
  role: AppRole,
  enabledFeatures: Iterable<AppFeaturePermission>
): Partial<Record<AppFeaturePermission, boolean>> {
  const selected = new Set(enabledFeatures);
  const defaults = new Set(ROLE_DEFAULT_FEATURES[role]);
  const overrides: Partial<Record<AppFeaturePermission, boolean>> = {};

  for (const feature of APP_FEATURES) {
    if (selected.has(feature) === defaults.has(feature)) {
      continue;
    }
    overrides[feature] = selected.has(feature);
  }

  return overrides;
}
