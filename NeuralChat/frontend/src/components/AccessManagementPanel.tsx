import { useEffect, useMemo, useState } from "react";

import {
  APP_FEATURES,
  APP_ROLES,
  ROLE_COLORS,
  ROLE_DEFAULT_FEATURES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type AppFeaturePermission,
  type AppRole,
  type UserAccessProfile,
  buildFeatureOverridePayload,
} from "../access";
import type { RequestNamingContext } from "../api";
import { deleteMember, getMembers, updateMemberFeatures, updateMemberRole, updateMemberUsageLimit } from "../api/members";
import { useAccess } from "../hooks/useAccess";
import { useApiQuery } from "../hooks/useApi";
import { queryClient } from "../lib/queryClient";
import { AccessRoleBadge } from "./access/AccessRoleBadge";

interface AccessManagementPanelProps {
  getAuthToken: () => Promise<string | null>;
  naming?: RequestNamingContext;
  onShowToast: (message: string, tone?: "success" | "info" | "error") => void;
}

interface MemberRowProps {
  authToken: string;
  member: UserAccessProfile;
  currentUserId: string | null;
  naming?: RequestNamingContext;
  onShowToast: (message: string, tone?: "success" | "info" | "error") => void;
  onUpdated: () => Promise<void>;
}

function formatCurrency(value: number): string {
  if (value >= 1) {
    return `$${value.toFixed(2)}`;
  }
  if (value >= 0.01) {
    return `$${value.toFixed(3)}`;
  }
  return `$${value.toFixed(4)}`;
}

function formatTokenCount(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return `${value}`;
}

function normalizeLimitDraft(value: string): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function FeatureToggleChip({
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
      className={`nc-access-feature-chip ${checked ? "nc-access-feature-chip--active" : ""}`}
      onClick={() => onToggle(feature)}
      disabled={disabled}
    >
      <span className="nc-access-feature-chip__dot" aria-hidden="true" />
      <span>{feature}</span>
    </button>
  );
}

function MemberRow({ authToken, member, currentUserId, naming, onShowToast, onUpdated }: MemberRowProps) {
  const [draftRole, setDraftRole] = useState<AppRole>(member.role);
  const [selectedFeatures, setSelectedFeatures] = useState<Set<AppFeaturePermission>>(new Set(member.effective_features));
  const [dailyDraft, setDailyDraft] = useState(member.usage_limits.daily_limit_usd.toFixed(2));
  const [monthlyDraft, setMonthlyDraft] = useState(member.usage_limits.monthly_limit_usd.toFixed(2));
  const [isSaving, setIsSaving] = useState(false);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    setDraftRole(member.role);
    setSelectedFeatures(new Set(member.effective_features));
    setDailyDraft(member.usage_limits.daily_limit_usd.toFixed(2));
    setMonthlyDraft(member.usage_limits.monthly_limit_usd.toFixed(2));
    setErrorText("");
  }, [member]);

  const canEdit = member.user_id !== currentUserId && !member.seeded_owner;
  const currentOverridesJson = JSON.stringify(member.feature_overrides);
  const nextOverrides = useMemo(
    () => buildFeatureOverridePayload(draftRole, selectedFeatures),
    [draftRole, selectedFeatures]
  );
  const nextOverridesJson = JSON.stringify(nextOverrides);

  async function handleSave() {
    if (!canEdit) {
      return;
    }

    setIsSaving(true);
    setErrorText("");

    try {
      if (draftRole !== member.role) {
        await updateMemberRole(authToken, member.user_id, draftRole, naming);
      }

      if (nextOverridesJson !== currentOverridesJson) {
        await updateMemberFeatures(authToken, member.user_id, nextOverrides, naming);
      }

      const nextDaily = normalizeLimitDraft(dailyDraft);
      const nextMonthly = normalizeLimitDraft(monthlyDraft);
      const dailyChanged = typeof nextDaily === "number" && nextDaily !== member.usage_limits.daily_limit_usd;
      const monthlyChanged = typeof nextMonthly === "number" && nextMonthly !== member.usage_limits.monthly_limit_usd;
      if (dailyChanged || monthlyChanged) {
        await updateMemberUsageLimit(
          authToken,
          member.user_id,
          {
            ...(dailyChanged ? { daily_limit_usd: nextDaily } : {}),
            ...(monthlyChanged ? { monthly_limit_usd: nextMonthly } : {}),
          },
          naming
        );
      }

      await onUpdated();
      onShowToast(`Updated access for ${member.display_name}.`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update member access.";
      setErrorText(message);
      onShowToast(message, "error");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRemove() {
    if (!canEdit) {
      return;
    }

    const confirmed = window.confirm(`Remove ${member.display_name} from NeuralChat?`);
    if (!confirmed) {
      return;
    }

    setIsSaving(true);
    setErrorText("");
    try {
      await deleteMember(authToken, member.user_id, naming);
      await onUpdated();
      onShowToast(`${member.display_name} removed.`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to remove member.";
      setErrorText(message);
      onShowToast(message, "error");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <article className="nc-access-member-card">
      <div className="nc-access-member-card__header">
        <div>
          <div className="nc-access-member-card__title-row">
            <strong>{member.display_name}</strong>
            <AccessRoleBadge role={member.role} />
            {member.seeded_owner ? <span className="nc-access-member-card__seeded">Seeded owner</span> : null}
          </div>
          <p>{member.email || member.user_id}</p>
        </div>
        {canEdit ? (
          <select value={draftRole} onChange={(event) => setDraftRole(event.target.value as AppRole)} disabled={isSaving}>
            {APP_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        ) : (
          <span className="nc-access-member-card__readonly">
            {member.user_id === currentUserId ? "Your account" : "Managed from env"}
          </span>
        )}
      </div>

      <div className="nc-access-member-card__stats">
        <div>
          <span>Today</span>
          <strong>{formatCurrency(member.usage?.daily_spent_usd ?? 0)}</strong>
        </div>
        <div>
          <span>Month</span>
          <strong>{formatCurrency(member.usage?.monthly_spent_usd ?? 0)}</strong>
        </div>
        <div>
          <span>30d tokens</span>
          <strong>{formatTokenCount((member.usage?.total_input_tokens ?? 0) + (member.usage?.total_output_tokens ?? 0))}</strong>
        </div>
      </div>

      <div className="nc-access-member-card__limits">
        <label>
          <span>Daily limit</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={dailyDraft}
            onChange={(event) => setDailyDraft(event.target.value)}
            disabled={isSaving || !canEdit}
          />
        </label>
        <label>
          <span>Monthly limit</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={monthlyDraft}
            onChange={(event) => setMonthlyDraft(event.target.value)}
            disabled={isSaving || !canEdit}
          />
        </label>
      </div>

      <div className="nc-access-member-card__features">
        {APP_FEATURES.map((feature) => (
          <FeatureToggleChip
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

      {errorText ? <p className="nc-access-member-card__error">{errorText}</p> : null}

      <div className="nc-access-member-card__actions">
        <button type="button" className="nc-settings-card__action" onClick={() => void handleSave()} disabled={isSaving || !canEdit}>
          {isSaving ? "Saving..." : "Save access"}
        </button>
        <button
          type="button"
          className="nc-settings-card__action nc-settings-card__action--danger"
          onClick={() => void handleRemove()}
          disabled={isSaving || !canEdit}
        >
          Remove user
        </button>
      </div>
    </article>
  );
}

export function AccessManagementPanel({ getAuthToken, naming, onShowToast }: AccessManagementPanelProps) {
  const { isOwner, isLoaded, userId } = useAccess();
  const [authToken, setAuthToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function resolveToken() {
      const token = await getAuthToken();
      if (!cancelled) {
        setAuthToken(token);
      }
    }

    void resolveToken();
    return () => {
      cancelled = true;
    };
  }, [getAuthToken]);

  const membersQuery = useApiQuery<UserAccessProfile[]>(["members"], "/api/members", {
    authToken,
    naming,
    enabled: Boolean(authToken) && isOwner,
    queryFn: async () => {
      if (!authToken) {
        throw new Error("Authentication token unavailable. Please sign in again.");
      }
      return await getMembers(authToken, naming);
    },
  });

  async function handleRefresh() {
    await queryClient.invalidateQueries({ queryKey: ["members"] });
    await membersQuery.refetch();
  }

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
        <div>
          <h4>Access management</h4>
          <p>Manage who can use projects, uploads, memory, agents, and spending controls across NeuralChat.</p>
        </div>
        <button type="button" className="nc-settings-card__action" onClick={() => void handleRefresh()}>
          Refresh
        </button>
      </div>

      <div className="nc-access-panel__role-grid">
        {APP_ROLES.map((role) => (
          <article
            key={role}
            className="nc-access-panel__role-card"
            style={{
              background: ROLE_COLORS[role].bg,
              borderColor: ROLE_COLORS[role].border,
            }}
          >
            <AccessRoleBadge role={role} />
            <p>{ROLE_DESCRIPTIONS[role]}</p>
            <span>{ROLE_DEFAULT_FEATURES[role].length} default capabilities</span>
          </article>
        ))}
      </div>

      <div className="nc-access-panel__members-header">
        <div>
          <h5>Current members</h5>
          <p>Owners are always allowed. Other accounts can be tightened down or granted extra features individually.</p>
        </div>
        <span>{membersQuery.data?.length ?? 0} users</span>
      </div>

      {membersQuery.error ? <p className="nc-access-member-card__error">{membersQuery.error.message}</p> : null}

      <div className="nc-access-panel__members-list">
        {(membersQuery.data ?? []).map((member) => (
          <MemberRow
            key={member.user_id}
            authToken={authToken ?? ""}
            member={member}
            currentUserId={userId}
            naming={naming}
            onShowToast={onShowToast}
            onUpdated={handleRefresh}
          />
        ))}
      </div>
    </section>
  );
}
