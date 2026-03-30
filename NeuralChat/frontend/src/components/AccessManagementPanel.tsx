import { useEffect, useMemo, useRef, useState } from "react";

import {
  APP_FEATURES,
  APP_ROLES,
  ROLE_COLORS,
  ROLE_DEFAULT_FEATURES,
  ROLE_LABELS,
  type AppFeaturePermission,
  type AppRole,
  type UserAccessProfile,
} from "../access";
import type { RequestNamingContext } from "../api";
import { deleteMember, getMemberUsage, getMembers, inviteMember, updateMemberFeatures, updateMemberRole, updateMemberUsageLimit } from "../api/members";
import { useAccess } from "../hooks/useAccess";
import { useApiQuery } from "../hooks/useApi";
import { queryClient } from "../lib/queryClient";
import { isInvalidAuthError, isSessionAuthTimeoutError, runWithSessionAuthToken } from "../utils/sessionAuth";
import { AccessRoleBadge } from "./access/AccessRoleBadge";
import { DataLoader } from "./DataLoader";
import { SkeletonCard } from "./SkeletonCard";

interface AccessManagementPanelProps {
  getAuthToken: () => Promise<string | null>;
  naming?: RequestNamingContext;
  onShowToast: (message: string, tone?: "success" | "info" | "error") => void;
}

type RunAccessTask = <T>(task: (authToken: string) => Promise<T>) => Promise<T>;

type RoleFilter = "all" | AppRole;

interface MemberEditorProps {
  member: UserAccessProfile;
  currentUserId: string | null;
  isUsageLoading: boolean;
  usageErrorMessage: string;
  naming?: RequestNamingContext;
  onShowToast: (message: string, tone?: "success" | "info" | "error") => void;
  onUpdated: () => Promise<void>;
  onRequestRemove: (member: UserAccessProfile) => void;
  runAccessTask: RunAccessTask;
}

interface InviteModalProps {
  open: boolean;
  submitting: boolean;
  email: string;
  role: AppRole;
  errorText: string;
  onClose: () => void;
  onEmailChange: (value: string) => void;
  onRoleChange: (value: AppRole) => void;
  onSubmit: () => void;
}

interface ConfirmRemoveModalProps {
  member: UserAccessProfile | null;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

const FEATURE_LABELS: Record<AppFeaturePermission, string> = {
  "chat:create": "Create chats",
  "project:create": "Create projects",
  "project:delete": "Delete projects",
  "agent:run": "Run agents",
  "file:upload": "Upload files",
  "memory:read": "Read memory",
  "memory:write": "Write memory",
  "usage:read": "View usage",
  "usage:manage": "Manage usage",
  "billing:manage": "Billing controls",
};

const FEATURE_GROUPS: Array<{ title: string; features: AppFeaturePermission[] }> = [
  { title: "Content", features: ["chat:create", "project:create"] },
  { title: "Data", features: ["file:upload", "memory:read", "memory:write"] },
  { title: "Execution", features: ["agent:run", "project:delete"] },
  { title: "Governance", features: ["usage:read", "usage:manage", "billing:manage"] },
];

function formatCurrency(value: number): string {
  if (value >= 1) {
    return `$${value.toFixed(2)}`;
  }
  if (value >= 0.01) {
    return `$${value.toFixed(3)}`;
  }
  return `$${value.toFixed(4)}`;
}

function normalizeLimitDraft(value: string): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function normalizeAccessError(error: unknown, fallbackMessage: string): string {
  if (isInvalidAuthError(error) || isSessionAuthTimeoutError(error)) {
    return "We couldn’t finish this access request right now. Please try again.";
  }
  return error instanceof Error && error.message.trim() ? error.message : fallbackMessage;
}

function formatUsageValue(value: number | undefined, isUsageLoading: boolean): string {
  if (typeof value === "number") {
    return formatCurrency(value);
  }
  return isUsageLoading ? "Loading…" : "--";
}

function buildMemberInitials(name: string, email?: string | null): string {
  const source = name.trim() || email?.trim() || "User";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function getProgressValue(spent: number | undefined, limit: number | undefined): number {
  if (typeof spent !== "number" || typeof limit !== "number" || limit <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, (spent / limit) * 100));
}

function formatLastActive(value?: string | null): string {
  if (!value) {
    return "No recent activity";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "No recent activity";
  }
  const diffMs = Date.now() - parsed.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) {
    return "Active just now";
  }
  if (diffMinutes < 60) {
    return `Active ${diffMinutes}m ago`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `Active ${diffHours}h ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `Active ${diffDays}d ago`;
  }
  return `Active ${parsed.toLocaleDateString()}`;
}

function FeatureToggleRow({
  feature,
  checked,
  disabled,
  onToggle,
}: {
  feature: AppFeaturePermission;
  checked: boolean;
  disabled: boolean;
  onToggle: (feature: AppFeaturePermission) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={`${FEATURE_LABELS[feature]} ${checked ? "enabled" : "disabled"}`}
      className={`nc-access-feature-row ${checked ? "nc-access-feature-row--active" : ""}`}
      disabled={disabled}
      onClick={() => onToggle(feature)}
    >
      <div className="nc-access-feature-row__copy">
        <strong>{FEATURE_LABELS[feature]}</strong>
      </div>
      <span className={`nc-access-feature-row__state ${checked ? "nc-access-feature-row__state--enabled" : ""}`}>
        {checked ? "Enabled" : "Disabled"}
      </span>
      <span className={`nc-access-feature-row__switch ${checked ? "nc-access-feature-row__switch--active" : ""}`} aria-hidden="true">
        <span className="nc-access-feature-row__thumb" />
      </span>
    </button>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M13.2 13.2L17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function InviteModal({ open, submitting, email, role, errorText, onClose, onEmailChange, onRoleChange, onSubmit }: InviteModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="nc-modal" role="dialog" aria-modal="true" aria-label="Invite user">
      <div className="nc-modal__backdrop" onClick={onClose} />
      <section className="nc-modal__panel nc-access-dialog">
        <div className="nc-access-dialog__header">
          <div>
            <h3>Invite user</h3>
            <p>Send an invitation and assign the default access role.</p>
          </div>
          <button type="button" className="nc-modal__close" onClick={onClose} aria-label="Close invite dialog">
            ×
          </button>
        </div>
        <div className="nc-access-dialog__body">
          <label className="nc-access-dialog__field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              placeholder="name@company.com"
              aria-label="Invite user email"
              autoFocus
            />
          </label>
          <label className="nc-access-dialog__field">
            <span>Role</span>
            <select value={role} onChange={(event) => onRoleChange(event.target.value as AppRole)} aria-label="Invite user role">
              {APP_ROLES.map((item) => (
                <option key={item} value={item}>
                  {ROLE_LABELS[item]}
                </option>
              ))}
            </select>
          </label>
          {errorText ? <p className="nc-access-panel__notice nc-access-panel__notice--error">{errorText}</p> : null}
        </div>
        <div className="nc-access-dialog__footer">
          <button type="button" className="nc-settings-card__action" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="button" className="nc-settings-card__action nc-settings-card__action--primary" onClick={onSubmit} disabled={submitting || !email.trim()}>
            {submitting ? "Sending…" : "Send invite"}
          </button>
        </div>
      </section>
    </div>
  );
}

function ConfirmRemoveModal({ member, submitting, onCancel, onConfirm }: ConfirmRemoveModalProps) {
  if (!member) {
    return null;
  }

  return (
    <div className="nc-modal" role="dialog" aria-modal="true" aria-label="Remove user">
      <div className="nc-modal__backdrop" onClick={onCancel} />
      <section className="nc-modal__panel nc-access-dialog nc-access-dialog--compact">
        <div className="nc-access-dialog__header">
          <div>
            <h3>Remove user</h3>
            <p>This removes the account from your NeuralChat workspace.</p>
          </div>
        </div>
        <div className="nc-access-dialog__body">
          <p className="nc-access-dialog__confirm-copy">
            Remove <strong>{member.display_name}</strong> ({member.email || member.user_id})?
          </p>
        </div>
        <div className="nc-access-dialog__footer">
          <button type="button" className="nc-settings-card__action" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button type="button" className="nc-settings-card__action nc-settings-card__action--danger" onClick={onConfirm} disabled={submitting}>
            {submitting ? "Removing…" : "Remove user"}
          </button>
        </div>
      </section>
    </div>
  );
}

function AccessEmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="nc-access-empty-state" role="status" aria-live="polite">
      <div className="nc-access-empty-state__art" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <strong>{title}</strong>
      <p>{message}</p>
    </div>
  );
}

function MemberEditor({ member, currentUserId, isUsageLoading, usageErrorMessage, naming, onShowToast, onUpdated, onRequestRemove, runAccessTask }: MemberEditorProps) {
  const [draftRole, setDraftRole] = useState<AppRole>(member.role);
  const [selectedFeatures, setSelectedFeatures] = useState<Set<AppFeaturePermission>>(new Set(member.effective_features));
  const [dailyDraft, setDailyDraft] = useState(member.usage_limits.daily_limit_usd.toFixed(2));
  const [monthlyDraft, setMonthlyDraft] = useState(member.usage_limits.monthly_limit_usd.toFixed(2));
  const [isSaving, setIsSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setDraftRole(member.role);
    setSelectedFeatures(new Set(member.effective_features));
    setDailyDraft(member.usage_limits.daily_limit_usd.toFixed(2));
    setMonthlyDraft(member.usage_limits.monthly_limit_usd.toFixed(2));
    setErrorText("");
    setMenuOpen(false);
  }, [member]);

  const canEdit = member.user_id !== currentUserId && !member.seeded_owner;
  const currentOverridesJson = JSON.stringify(member.feature_overrides);
  const nextOverrides = useMemo(() => {
    const selected = new Set(selectedFeatures);
    const defaults = new Set(ROLE_DEFAULT_FEATURES[draftRole]);
    const overrides: Partial<Record<AppFeaturePermission, boolean>> = {};

    for (const feature of APP_FEATURES) {
      if (selected.has(feature) === defaults.has(feature)) {
        continue;
      }
      overrides[feature] = selected.has(feature);
    }

    return overrides;
  }, [draftRole, selectedFeatures]);

  const nextOverridesJson = JSON.stringify(nextOverrides);
  const nextDaily = normalizeLimitDraft(dailyDraft);
  const nextMonthly = normalizeLimitDraft(monthlyDraft);
  const dailyLimitValid = typeof nextDaily === "number";
  const monthlyLimitValid = typeof nextMonthly === "number";
  const rangeValid = dailyLimitValid && monthlyLimitValid && nextDaily <= nextMonthly;
  const validationMessage = !dailyLimitValid || !monthlyLimitValid ? "Enter valid daily and monthly limits." : !rangeValid ? "Daily limit must be less than or equal to monthly limit." : "";
  const hasRoleChange = draftRole !== member.role;
  const hasFeatureChange = nextOverridesJson !== currentOverridesJson;
  const hasDailyChange = dailyLimitValid && nextDaily !== member.usage_limits.daily_limit_usd;
  const hasMonthlyChange = monthlyLimitValid && nextMonthly !== member.usage_limits.monthly_limit_usd;
  const hasChanges = hasRoleChange || hasFeatureChange || hasDailyChange || hasMonthlyChange;
  const dailyProgress = getProgressValue(member.usage?.daily_spent_usd, nextDaily);
  const monthlyProgress = getProgressValue(member.usage?.monthly_spent_usd, nextMonthly);
  const palette = ROLE_COLORS[draftRole];

  function handleUndo() {
    setDraftRole(member.role);
    setSelectedFeatures(new Set(member.effective_features));
    setDailyDraft(member.usage_limits.daily_limit_usd.toFixed(2));
    setMonthlyDraft(member.usage_limits.monthly_limit_usd.toFixed(2));
    setErrorText("");
  }

  async function handleSave() {
    if (!canEdit || !hasChanges || !rangeValid || !dailyLimitValid || !monthlyLimitValid) {
      return;
    }

    setIsSaving(true);
    setErrorText("");

    try {
      await runAccessTask(async (authToken) => {
        if (hasRoleChange) {
          await updateMemberRole(authToken, member.user_id, draftRole, naming);
        }
        if (hasFeatureChange) {
          await updateMemberFeatures(authToken, member.user_id, nextOverrides, naming);
        }
        if (hasDailyChange || hasMonthlyChange) {
          await updateMemberUsageLimit(
            authToken,
            member.user_id,
            {
              ...(hasDailyChange ? { daily_limit_usd: nextDaily } : {}),
              ...(hasMonthlyChange ? { monthly_limit_usd: nextMonthly } : {}),
            },
            naming
          );
        }
      });

      await onUpdated();
      onShowToast(`Updated access for ${member.display_name}.`, "success");
    } catch (error) {
      const message = normalizeAccessError(error, "Failed to update member access.");
      setErrorText(message);
      onShowToast(message, "error");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <article className="nc-access-member-card">
      <div className="nc-access-member-card__top">
        <div className="nc-access-member-card__identity">
          <div
            className="nc-access-member-card__avatar"
            style={{ background: palette.bg, borderColor: palette.border, color: palette.text }}
          >
            {buildMemberInitials(member.display_name, member.email)}
          </div>
          <div className="nc-access-member-card__identity-copy">
            <div className="nc-access-member-card__title-row">
              <strong>{member.display_name}</strong>
              <AccessRoleBadge role={member.role} />
              {member.seeded_owner ? <span className="nc-access-member-card__readonly">Seeded owner</span> : null}
              {member.user_id === currentUserId ? <span className="nc-access-member-card__readonly">You</span> : null}
            </div>
            <p title={member.email || member.user_id}>{member.email || member.user_id}</p>
            <small title={member.last_active_at ?? undefined}>{formatLastActive(member.last_active_at)}</small>
          </div>
        </div>

        <div className="nc-access-member-card__controls">
          {canEdit ? (
            <label className="nc-access-member-card__role-field">
              <span>Role</span>
              <select
                value={draftRole}
                onChange={(event) => setDraftRole(event.target.value as AppRole)}
                disabled={isSaving}
                aria-label="Change user role"
              >
                {APP_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="nc-access-member-card__role-field nc-access-member-card__role-field--readonly">
              <span>Role</span>
              <div className="nc-access-member-card__readonly-value">{ROLE_LABELS[member.role]}</div>
            </div>
          )}

          {canEdit ? (
            <div className="nc-access-member-card__overflow">
              <button
                type="button"
                className="nc-access-icon-button"
                aria-label="Open member actions"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((value) => !value)}
              >
                ⋯
              </button>
              {menuOpen ? (
                <div className="nc-access-overflow-menu" role="menu" aria-label="Member actions">
                  <button
                    type="button"
                    role="menuitem"
                    className="nc-access-overflow-menu__item nc-access-overflow-menu__item--danger"
                    onClick={() => {
                      setMenuOpen(false);
                      onRequestRemove(member);
                    }}
                  >
                    Remove user
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="nc-access-member-card__metrics">
        <div className="nc-access-metric-card">
          <span className="nc-access-metric-card__label">Today</span>
          <strong>{formatUsageValue(member.usage?.daily_spent_usd, isUsageLoading)}</strong>
          <small>vs. yesterday: neutral</small>
        </div>
        <div className="nc-access-metric-card">
          <span className="nc-access-metric-card__label">This month</span>
          <strong>{formatUsageValue(member.usage?.monthly_spent_usd, isUsageLoading)}</strong>
          <small>vs. last month: neutral</small>
        </div>
      </div>

      <div className="nc-access-member-card__section">
        <div className="nc-access-member-card__section-head">
          <strong>Spend limits</strong>
        </div>
        <div className="nc-access-member-card__limits-grid">
          <label className="nc-access-member-card__input-field">
            <span>Daily limit</span>
            <div className="nc-access-input-shell">
              <span>$</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={dailyDraft}
                onChange={(event) => setDailyDraft(event.target.value)}
                disabled={isSaving || !canEdit}
                aria-label="Daily limit"
              />
            </div>
            <div className="nc-access-progress" aria-hidden="true">
              <div style={{ width: `${dailyProgress}%` }} />
            </div>
            <small>{formatUsageValue(member.usage?.daily_spent_usd, isUsageLoading)} used</small>
          </label>
          <label className="nc-access-member-card__input-field">
            <span>Monthly limit</span>
            <div className="nc-access-input-shell">
              <span>$</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={monthlyDraft}
                onChange={(event) => setMonthlyDraft(event.target.value)}
                disabled={isSaving || !canEdit}
                aria-label="Monthly limit"
              />
            </div>
            <div className="nc-access-progress" aria-hidden="true">
              <div style={{ width: `${monthlyProgress}%` }} />
            </div>
            <small>{formatUsageValue(member.usage?.monthly_spent_usd, isUsageLoading)} used</small>
          </label>
        </div>
        {validationMessage ? <p className="nc-access-panel__notice nc-access-panel__notice--error">{validationMessage}</p> : null}
      </div>

      <div className="nc-access-member-card__section">
        <div className="nc-access-member-card__section-head">
          <strong>Permissions</strong>
          <small>Adjust only what differs from the role default.</small>
        </div>
        <div className="nc-access-permission-groups">
          {FEATURE_GROUPS.map((group) => (
            <section key={group.title} className="nc-access-permission-group">
              <h5>{group.title}</h5>
              <div className="nc-access-permission-group__rows">
                {group.features.map((feature) => (
                  <FeatureToggleRow
                    key={feature}
                    feature={feature}
                    checked={selectedFeatures.has(feature)}
                    disabled={!canEdit || isSaving}
                    onToggle={(nextFeature) => {
                      setSelectedFeatures((previous) => {
                        const next = new Set(previous);
                        if (next.has(nextFeature)) {
                          next.delete(nextFeature);
                        } else {
                          next.add(nextFeature);
                        }
                        return next;
                      });
                    }}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      {usageErrorMessage ? <p className="nc-access-panel__notice nc-access-panel__notice--warning">{usageErrorMessage}</p> : null}
      {errorText ? <p className="nc-access-panel__notice nc-access-panel__notice--error">{errorText}</p> : null}

      <div className="nc-access-member-card__footer">
        <span className="nc-access-member-card__status">{hasChanges ? "Unsaved changes" : "No pending changes"}</span>
        <div className="nc-access-member-card__actions">
          <button type="button" className="nc-settings-card__action" onClick={handleUndo} disabled={isSaving || !hasChanges}>
            Undo
          </button>
          <button
            type="button"
            className="nc-settings-card__action nc-settings-card__action--primary"
            onClick={() => void handleSave()}
            disabled={isSaving || !canEdit || !hasChanges || !rangeValid || !dailyLimitValid || !monthlyLimitValid}
          >
            {isSaving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </article>
  );
}

export function AccessManagementPanel({ getAuthToken, naming, onShowToast }: AccessManagementPanelProps) {
  const { isOwner, isLoaded, userId } = useAccess();
  const authTokenRef = useRef<string>("");
  const membersQueryKey = useMemo(() => ["members"], []);
  const [cachedMembers, setCachedMembers] = useState<UserAccessProfile[]>(() => queryClient.getQueryData<UserAccessProfile[]>(membersQueryKey) ?? []);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AppRole>("user");
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteErrorText, setInviteErrorText] = useState("");
  const [pendingRemove, setPendingRemove] = useState<UserAccessProfile | null>(null);
  const [removeSubmitting, setRemoveSubmitting] = useState(false);

  const runAccessTask: RunAccessTask = async (task) => {
    return await runWithSessionAuthToken(
      { authToken: authTokenRef.current, getAuthToken },
      async (resolvedAuthToken) => {
        authTokenRef.current = resolvedAuthToken;
        return await task(resolvedAuthToken);
      },
      { timeoutMs: 6000 }
    );
  };

  const membersQuery = useApiQuery<UserAccessProfile[]>(membersQueryKey, "/api/members", {
    naming,
    enabled: isOwner,
    queryFn: async () => await runAccessTask(async (authToken) => await getMembers(authToken, naming)),
  });

  useEffect(() => {
    setCachedMembers(queryClient.getQueryData<UserAccessProfile[]>(membersQueryKey) ?? []);
  }, [membersQueryKey]);

  useEffect(() => {
    if (membersQuery.data) {
      setCachedMembers(membersQuery.data);
    }
  }, [membersQuery.data]);

  const members = membersQuery.data ?? cachedMembers;

  const summary = useMemo(() => {
    const counts = { owner: 0, member: 0, user: 0 } as Record<AppRole, number>;
    members.forEach((member) => {
      counts[member.role] += 1;
    });
    return counts;
  }, [members]);

  const filteredMembers = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();
    return members.filter((member) => {
      const matchesRole = roleFilter === "all" || member.role === roleFilter;
      if (!matchesRole) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }
      const haystack = `${member.display_name} ${member.email ?? ""}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [members, roleFilter, searchText]);

  useEffect(() => {
    if (!filteredMembers.length) {
      setSelectedMemberId(null);
      return;
    }
    if (!selectedMemberId || !filteredMembers.some((member) => member.user_id === selectedMemberId)) {
      setSelectedMemberId(filteredMembers[0].user_id);
    }
  }, [filteredMembers, selectedMemberId]);

  const selectedMember = useMemo(
    () => filteredMembers.find((member) => member.user_id === selectedMemberId) ?? null,
    [filteredMembers, selectedMemberId]
  );

  const selectedUsageQuery = useApiQuery(["member-usage", selectedMember?.user_id ?? "none"], "/api/members/usage", {
    naming,
    enabled: isOwner && Boolean(selectedMember?.user_id),
    queryFn: async () => {
      if (!selectedMember?.user_id) {
        return null;
      }
      return await runAccessTask(async (authToken) => await getMemberUsage(authToken, selectedMember.user_id, naming));
    },
  });

  const selectedMemberWithUsage = useMemo(() => {
    if (!selectedMember) {
      return null;
    }
    const cachedUsage = queryClient.getQueryData(["member-usage", selectedMember.user_id]);
    const usage = selectedUsageQuery.data ?? cachedUsage ?? selectedMember.usage ?? null;
    return {
      ...selectedMember,
      usage,
    };
  }, [selectedMember, selectedUsageQuery.data]);

  async function handleRefresh() {
    await queryClient.invalidateQueries({ queryKey: ["members"] });
    await queryClient.invalidateQueries({ queryKey: ["member-usage"] });
    await Promise.allSettled([membersQuery.refetch(), selectedUsageQuery.refetch()]);
  }

  async function handleInviteSubmit() {
    if (!inviteEmail.trim()) {
      setInviteErrorText("Enter an email address.");
      return;
    }

    setInviteSubmitting(true);
    setInviteErrorText("");
    try {
      await runAccessTask(async (authToken) => await inviteMember(authToken, { email: inviteEmail.trim(), role: inviteRole }, naming));
      setInviteOpen(false);
      setInviteEmail("");
      setInviteRole("user");
      onShowToast("Invitation sent. The user will appear here after they accept.", "success");
    } catch (error) {
      const message = normalizeAccessError(error, "Failed to send invitation.");
      setInviteErrorText(message);
      onShowToast(message, "error");
    } finally {
      setInviteSubmitting(false);
    }
  }

  async function handleConfirmRemove() {
    if (!pendingRemove) {
      return;
    }

    setRemoveSubmitting(true);
    try {
      await runAccessTask(async (authToken) => {
        await deleteMember(authToken, pendingRemove.user_id, naming);
      });
      onShowToast(`${pendingRemove.display_name} removed.`, "success");
      setPendingRemove(null);
      await handleRefresh();
    } catch (error) {
      const message = normalizeAccessError(error, "Failed to remove member.");
      onShowToast(message, "error");
    } finally {
      setRemoveSubmitting(false);
    }
  }

  const membersErrorMessage = membersQuery.error ? normalizeAccessError(membersQuery.error, "Failed to load users.") : "";
  const usageErrorMessage = !membersQuery.error && selectedUsageQuery.error ? normalizeAccessError(selectedUsageQuery.error, "Failed to load usage.") : "";

  if (!isLoaded) {
    return <div className="nc-settings-card"><p>Loading access controls…</p></div>;
  }

  if (!isOwner) {
    return (
      <section className="nc-settings-card">
        <h4>Access management</h4>
        <p>Only owners can manage roles, features, and per-user limits.</p>
      </section>
    );
  }

  return (
    <section className="nc-settings-card nc-access-panel">
      <div className="nc-access-panel__header">
        <div className="nc-access-panel__header-copy">
          <span className="nc-access-panel__eyebrow">Admin console</span>
          <div className="nc-access-panel__title-row">
            <h4>Access management</h4>
            <span className="nc-access-panel__member-count">{members.length} users</span>
          </div>
          <span className="nc-access-panel__distribution">
            {summary.owner ? `${summary.owner} owner${summary.owner > 1 ? "s" : ""}` : null}
            {summary.owner && (summary.member || summary.user) ? <span aria-hidden="true">·</span> : null}
            {summary.member ? `${summary.member} member${summary.member > 1 ? "s" : ""}` : null}
            {summary.member && summary.user ? <span aria-hidden="true">·</span> : null}
            {summary.user ? `${summary.user} user${summary.user > 1 ? "s" : ""}` : null}
          </span>
        </div>
        <div className="nc-access-panel__header-actions">
          <button
            type="button"
            className="nc-settings-card__action nc-settings-card__action--primary"
            onClick={() => setInviteOpen(true)}
            aria-label="Invite user"
          >
            + Invite user
          </button>
          <button type="button" className="nc-settings-card__action" onClick={() => void handleRefresh()} aria-label="Refresh access management">
            Refresh
          </button>
        </div>
      </div>

      {membersErrorMessage ? <p className="nc-access-panel__notice nc-access-panel__notice--error">{membersErrorMessage}</p> : null}

      <DataLoader
        data={members.length > 0 ? members : null}
        isLoading={members.length === 0 && membersQuery.isLoading}
        isFetching={membersQuery.isFetching}
        isStale={membersQuery.isStale}
        emptyState={<div className="nc-settings-card"><p>No users found yet.</p></div>}
        skeleton={
          <div className="nc-access-panel__members-list">
            <SkeletonCard rows={2} showAvatar />
            <SkeletonCard rows={2} showAvatar />
            <SkeletonCard rows={2} showAvatar />
          </div>
        }
      >
        {() => (
          <div className="nc-access-panel__workspace">
            <aside className="nc-access-panel__member-list" aria-label="Users">
              <div className="nc-access-panel__member-list-head">
                <div className="nc-access-panel__member-list-head-copy">
                  <strong>Users</strong>
                  <small>{filteredMembers.length} shown</small>
                </div>
                <span className="nc-access-panel__member-list-meta">Directory</span>
              </div>
              <div className="nc-access-panel__filters">
                <label className="nc-access-panel__search-shell">
                  <span className="nc-access-panel__visually-hidden">Search users</span>
                  <span className="nc-access-panel__search-icon">
                    <SearchIcon />
                  </span>
                  <input
                    type="search"
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                    placeholder="Search people"
                    aria-label="Search users"
                  />
                </label>
                <label className="nc-access-panel__filter-select">
                  <span className="nc-access-panel__visually-hidden">Filter by role</span>
                  <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as RoleFilter)} aria-label="Filter users by role">
                    <option value="all">All roles</option>
                    {APP_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {filteredMembers.length ? (
                <div className="nc-access-panel__member-list-items">
                  {filteredMembers.map((member) => (
                    <button
                      key={member.user_id}
                      type="button"
                      className={`nc-access-member-list-item ${selectedMember?.user_id === member.user_id ? "nc-access-member-list-item--active" : ""}`}
                      onClick={() => setSelectedMemberId(member.user_id)}
                      aria-label={`Select ${member.display_name}`}
                    >
                      <div
                        className="nc-access-member-list-item__avatar"
                        style={{
                          background: ROLE_COLORS[member.role].bg,
                          borderColor: ROLE_COLORS[member.role].border,
                          color: ROLE_COLORS[member.role].text,
                        }}
                      >
                        {buildMemberInitials(member.display_name, member.email)}
                      </div>
                      <div className="nc-access-member-list-item__copy">
                        <div className="nc-access-member-list-item__title-row">
                          <strong>{member.display_name}</strong>
                          <AccessRoleBadge role={member.role} />
                        </div>
                        <p title={member.email || member.user_id}>{member.email || member.user_id}</p>
                        <small title={member.last_active_at ?? undefined}>{formatLastActive(member.last_active_at)}</small>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <AccessEmptyState title="No matching users" message="Try a different search or role filter." />
              )}
            </aside>

            <div className="nc-access-panel__member-detail">
              {selectedMemberWithUsage ? (
                <MemberEditor
                  key={selectedMemberWithUsage.user_id}
                  member={selectedMemberWithUsage}
                  currentUserId={userId}
                  isUsageLoading={selectedUsageQuery.isLoading || selectedUsageQuery.isFetching}
                  usageErrorMessage={usageErrorMessage}
                  naming={naming}
                  onShowToast={onShowToast}
                  onUpdated={handleRefresh}
                  onRequestRemove={setPendingRemove}
                  runAccessTask={runAccessTask}
                />
              ) : (
                <AccessEmptyState title="Select a user" message="Pick a team member to review their role, spend limits, and permissions." />
              )}
            </div>
          </div>
        )}
      </DataLoader>

      <InviteModal
        open={inviteOpen}
        submitting={inviteSubmitting}
        email={inviteEmail}
        role={inviteRole}
        errorText={inviteErrorText}
        onClose={() => {
          if (inviteSubmitting) {
            return;
          }
          setInviteOpen(false);
          setInviteErrorText("");
        }}
        onEmailChange={setInviteEmail}
        onRoleChange={setInviteRole}
        onSubmit={() => void handleInviteSubmit()}
      />

      <ConfirmRemoveModal
        member={pendingRemove}
        submitting={removeSubmitting}
        onCancel={() => {
          if (!removeSubmitting) {
            setPendingRemove(null);
          }
        }}
        onConfirm={() => void handleConfirmRemove()}
      />
    </section>
  );
}
