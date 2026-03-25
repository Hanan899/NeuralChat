import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { RequestNamingContext } from "../api";
import { getUsageStatus, getUsageSummary, updateUsageLimit } from "../api/usage";
import type { UsageStatusResponse, UsageSummary } from "../types";
import { LimitSetter } from "./LimitSetter";

export interface CostDashboardContentProps {
  getAuthToken: () => Promise<string | null>;
  naming?: RequestNamingContext;
  onShowToast: (message: string, tone?: "success" | "info" | "error") => void;
  onUsageStateChange?: (status: UsageStatusResponse) => void;
}

interface CostDashboardProps extends CostDashboardContentProps {
  isOpen: boolean;
  onClose: () => void;
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
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M tok`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(0)}K tok`;
  }
  return `${value} tok`;
}

function buildFeatureRows(summary: UsageSummary) {
  const featureLabelMap: Record<string, string> = {
    chat: "Chat",
    memory: "Memory",
    search_decision: "Search",
    agent_plan: "Agent Plan",
    agent_step: "Agent Steps",
    agent_summary: "Agent Summary",
    title_generation: "Titles",
  };

  return Object.entries(summary.by_feature)
    .map(([featureKey, featureValue]) => ({
      feature: featureLabelMap[featureKey] ?? featureKey,
      rawFeature: featureKey,
      cost_usd: featureValue.cost_usd,
      calls: featureValue.calls,
    }))
    .filter((row) => row.cost_usd > 0 || row.calls > 0);
}

export function CostDashboardContent({
  getAuthToken,
  naming,
  onShowToast,
  onUsageStateChange,
}: CostDashboardContentProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [usageStatus, setUsageStatus] = useState<UsageStatusResponse | null>(null);
  const [isSavingLimit, setIsSavingLimit] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    async function loadDashboard() {
      setIsLoading(true);
      setErrorText("");
      try {
        const authToken = await getAuthToken();
        if (!authToken) {
          throw new Error("Authentication token unavailable. Please sign in again.");
        }
        const [statusPayload, usageSummary] = await Promise.all([
          getUsageStatus(authToken, naming),
          getUsageSummary(31, authToken, naming),
        ]);
        if (isCancelled) {
          return;
        }
        setSummary(usageSummary);
        setUsageStatus(statusPayload);
        onUsageStateChange?.(statusPayload);
      } catch (error) {
        if (!isCancelled) {
          setErrorText(error instanceof Error ? error.message : "Failed to load cost dashboard.");
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadDashboard();
    const intervalId = window.setInterval(() => {
      void loadDashboard();
    }, 60_000);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [getAuthToken, naming, onUsageStateChange]);

  const currentMonthStats = useMemo(() => {
    const today = new Date();
    const elapsedDays = Math.max(1, today.getUTCDate());
    const thisMonthCostUsd = usageStatus?.monthly.spent_usd ?? 0;
    return {
      thisMonthCostUsd,
      averagePerDayUsd: thisMonthCostUsd / elapsedDays,
    };
  }, [usageStatus]);

  const featureRows = useMemo(
    () =>
      buildFeatureRows(
        summary ?? {
          total_cost_usd: 0,
          total_input_tokens: 0,
          total_output_tokens: 0,
          by_feature: {},
          daily_costs: [],
        }
      ),
    [summary]
  );

  async function handleSaveLimit(limitKey: "daily_limit_usd" | "monthly_limit_usd", nextLimitUsd: number) {
    setIsSavingLimit(true);
    try {
      const authToken = await getAuthToken();
      if (!authToken) {
        throw new Error("Authentication token unavailable. Please sign in again.");
      }
      const response = await updateUsageLimit(authToken, { [limitKey]: nextLimitUsd }, naming);
      setUsageStatus((previous) => {
        if (!previous) {
          return previous;
        }
        const nextStatus: UsageStatusResponse = {
          ...previous,
          daily: {
            ...previous.daily,
            limit_usd: response.daily_limit_usd,
            remaining_usd: Math.max(response.daily_limit_usd - previous.daily.spent_usd, 0),
            percentage_used: response.daily_limit_usd > 0 ? Number(((previous.daily.spent_usd / response.daily_limit_usd) * 100).toFixed(2)) : 0,
            limit_exceeded: previous.daily.spent_usd >= response.daily_limit_usd,
            warning_triggered:
              response.daily_limit_usd > 0 ? (previous.daily.spent_usd / response.daily_limit_usd) * 100 >= 80 : false,
          },
          monthly: {
            ...previous.monthly,
            limit_usd: response.monthly_limit_usd,
            remaining_usd: Math.max(response.monthly_limit_usd - previous.monthly.spent_usd, 0),
            percentage_used: response.monthly_limit_usd > 0 ? Number(((previous.monthly.spent_usd / response.monthly_limit_usd) * 100).toFixed(2)) : 0,
            limit_exceeded: previous.monthly.spent_usd >= response.monthly_limit_usd,
            warning_triggered:
              response.monthly_limit_usd > 0 ? (previous.monthly.spent_usd / response.monthly_limit_usd) * 100 >= 80 : false,
          },
          blocked: previous.blocked,
          blocking_period: previous.blocking_period,
          blocking_message: previous.blocking_message,
        };
        onUsageStateChange?.(nextStatus);
        return nextStatus;
      });
      onShowToast(response.message, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update usage limit.";
      setErrorText(message);
      onShowToast(message, "error");
      throw error;
    } finally {
      setIsSavingLimit(false);
    }
  }

  return (
    <>
      {errorText ? <p className="nc-cost-panel__error">{errorText}</p> : null}

      {isLoading && !summary && !usageStatus ? (
        <div className="nc-cost-skeletons">
          <div className="nc-cost-skeleton nc-cost-skeleton--large" />
          <div className="nc-cost-skeleton nc-cost-skeleton--row" />
          <div className="nc-cost-skeleton nc-cost-skeleton--chart" />
          <div className="nc-cost-skeleton nc-cost-skeleton--chart" />
        </div>
      ) : (
        <div className="nc-cost-panel__body">
          <section className="nc-cost-card nc-cost-card--today">
            <div className="nc-cost-card__head">
              <h3>Today's cost</h3>
              {usageStatus ? <span>{formatCurrency(usageStatus.daily.spent_usd)} / {formatCurrency(usageStatus.daily.limit_usd)}</span> : null}
            </div>
            <div className="nc-cost-progress" aria-label="Daily usage progress bar">
              <div
                className={`nc-cost-progress__fill ${usageStatus?.daily.limit_exceeded ? "nc-cost-progress__fill--danger" : usageStatus && usageStatus.daily.warning_triggered ? "nc-cost-progress__fill--warning" : ""}`}
                style={{ width: `${Math.min(usageStatus?.daily.percentage_used ?? 0, 100)}%` }}
              />
            </div>
            <div className="nc-cost-card__meta">
              <span>{Math.round(usageStatus?.daily.percentage_used ?? 0)}%</span>
              <span>{usageStatus?.blocked && usageStatus.blocking_period === "daily" ? "Daily limit reached" : "Warning at 80%"}</span>
            </div>
          </section>

          <div className="nc-cost-summary-grid">
            <section className="nc-cost-card">
              <p className="nc-cost-section-label">This month</p>
              <h3>{formatCurrency(currentMonthStats.thisMonthCostUsd)}</h3>
              {usageStatus ? <p className="nc-cost-card__mini-meta">{Math.round(usageStatus.monthly.percentage_used)}% of monthly budget</p> : null}
            </section>
            <section className="nc-cost-card">
              <p className="nc-cost-section-label">Monthly limit</p>
              <h3>{formatCurrency(usageStatus?.monthly.limit_usd ?? 0)}</h3>
              {usageStatus?.blocked && usageStatus.blocking_period === "monthly" ? <p className="nc-cost-card__mini-meta">Monthly limit reached</p> : null}
            </section>
            <section className="nc-cost-card">
              <p className="nc-cost-section-label">Total</p>
              <h3>{formatTokenCount((summary?.total_input_tokens ?? 0) + (summary?.total_output_tokens ?? 0))}</h3>
            </section>
            <section className="nc-cost-card">
              <p className="nc-cost-section-label">Avg / day</p>
              <h3>{formatCurrency(currentMonthStats.averagePerDayUsd)}</h3>
            </section>
          </div>

          <div className="nc-cost-limits-grid">
            <LimitSetter
              label="Daily limit"
              limitUsd={usageStatus?.daily.limit_usd ?? 1}
              isSaving={isSavingLimit}
              onSave={(nextLimitUsd) => handleSaveLimit("daily_limit_usd", nextLimitUsd)}
            />
            <LimitSetter
              label="Monthly limit"
              limitUsd={usageStatus?.monthly.limit_usd ?? 30}
              isSaving={isSavingLimit}
              onSave={(nextLimitUsd) => handleSaveLimit("monthly_limit_usd", nextLimitUsd)}
            />
          </div>

          <section className="nc-cost-card">
            <div className="nc-cost-card__head">
              <h3>Cost by feature</h3>
              <span>{featureRows.length === 0 ? "No usage yet" : `${featureRows.length} tracked features`}</span>
            </div>
            <div className="nc-cost-chart" data-testid="cost-feature-breakdown">
              {featureRows.length === 0 ? (
                <p className="nc-cost-empty">No usage yet for the selected window.</p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={featureRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" opacity={0.25} />
                      <XAxis dataKey="feature" stroke="var(--text-secondary)" tickLine={false} axisLine={false} />
                      <YAxis stroke="var(--text-secondary)" tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
                      <Tooltip formatter={(value: number) => formatCurrency(Number(value))} />
                      <Bar dataKey="cost_usd" fill="var(--accent-primary)" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>

                  <div className="nc-cost-feature-list">
                    {featureRows.map((featureRow) => (
                      <div key={featureRow.rawFeature} className="nc-cost-feature-list__row">
                        <span>{featureRow.feature}</span>
                        <span>{formatCurrency(featureRow.cost_usd)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>

          <section className="nc-cost-card">
            <div className="nc-cost-card__head">
              <h3>Daily cost</h3>
              <span>Last 30 days</span>
            </div>
            <div className="nc-cost-chart" data-testid="cost-daily-chart">
              {summary?.daily_costs?.length ? (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={summary.daily_costs.slice(-30)} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" opacity={0.25} />
                    <XAxis dataKey="date" stroke="var(--text-secondary)" tickLine={false} axisLine={false} tickFormatter={(value) => value.slice(5)} />
                    <YAxis stroke="var(--text-secondary)" tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
                    <Tooltip formatter={(value: number) => formatCurrency(Number(value))} />
                    <Line type="monotone" dataKey="cost_usd" stroke="var(--accent-primary)" strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="nc-cost-empty">No daily usage points yet.</p>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export function CostDashboard({
  isOpen,
  onClose,
  getAuthToken,
  naming,
  onShowToast,
  onUsageStateChange,
}: CostDashboardProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <>
      <div className="nc-modal nc-cost-modal" role="dialog" aria-modal="true" aria-label="Cost dashboard">
        <div className="nc-modal__backdrop" onClick={onClose} />
        <section className="nc-modal__panel nc-cost-panel" data-testid="cost-dashboard-panel">
          <header className="nc-cost-panel__header">
            <div>
              <p className="nc-panel-eyebrow">Settings</p>
              <h2>Cost monitoring</h2>
              <p>Budgets, usage, and spend tracking</p>
            </div>
            <button type="button" className="nc-modal__close" aria-label="Close cost dashboard" onClick={onClose}>
              ×
            </button>
          </header>

          <CostDashboardContent
            getAuthToken={getAuthToken}
            naming={naming}
            onShowToast={onShowToast}
            onUsageStateChange={onUsageStateChange}
          />
        </section>
      </div>
    </>
  );
}
