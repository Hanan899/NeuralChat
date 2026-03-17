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
import { getTodayUsage, getUsageLimit, getUsageSummary, updateUsageLimit } from "../api/usage";
import type { DailyLimitSummary, UsageSummary } from "../types";
import { LimitSetter } from "./LimitSetter";

export interface CostDashboardContentProps {
  getAuthToken: () => Promise<string | null>;
  naming?: RequestNamingContext;
  onShowToast: (message: string, tone?: "success" | "info" | "error") => void;
  onUsageStateChange?: (summary: DailyLimitSummary) => void;
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
  const [todaySummary, setTodaySummary] = useState<DailyLimitSummary | null>(null);
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
        const [todayPayload, usageSummary, limitPayload] = await Promise.all([
          getTodayUsage(authToken, naming),
          getUsageSummary(31, authToken, naming),
          getUsageLimit(authToken, naming),
        ]);
        if (isCancelled) {
          return;
        }
        setSummary(usageSummary);
        const mergedTodaySummary = {
          ...todayPayload.summary,
          daily_limit_usd: limitPayload.daily_limit_usd,
          percentage_used:
            limitPayload.daily_limit_usd > 0
              ? Number(((todayPayload.summary.today_cost_usd / limitPayload.daily_limit_usd) * 100).toFixed(2))
              : 0,
          limit_exceeded: todayPayload.summary.today_cost_usd > limitPayload.daily_limit_usd,
        };
        setTodaySummary(mergedTodaySummary);
        onUsageStateChange?.(mergedTodaySummary);
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
    const currentMonth = today.getUTCMonth();
    const currentYear = today.getUTCFullYear();
    const monthlyPoints = (summary?.daily_costs ?? []).filter((entry) => {
      const entryDate = new Date(`${entry.date}T00:00:00Z`);
      return entryDate.getUTCMonth() === currentMonth && entryDate.getUTCFullYear() === currentYear;
    });
    const currentMonthCost = monthlyPoints.reduce((total, entry) => total + entry.cost_usd, 0);
    const elapsedDays = Math.max(1, today.getUTCDate());
    return {
      thisMonthCostUsd: currentMonthCost,
      averagePerDayUsd: currentMonthCost / elapsedDays,
    };
  }, [summary]);

  const featureRows = useMemo(() => buildFeatureRows(summary ?? {
    total_cost_usd: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    by_feature: {},
    daily_costs: [],
  }), [summary]);

  async function handleSaveDailyLimit(nextLimitUsd: number) {
    setIsSavingLimit(true);
    try {
      const authToken = await getAuthToken();
      if (!authToken) {
        throw new Error("Authentication token unavailable. Please sign in again.");
      }
      const response = await updateUsageLimit(authToken, nextLimitUsd, naming);
      setTodaySummary((previous) => {
        if (!previous) {
          return previous;
        }
        const updatedSummary = {
          ...previous,
          daily_limit_usd: response.daily_limit_usd,
          percentage_used:
            previous.today_cost_usd > 0
              ? Number(((previous.today_cost_usd / response.daily_limit_usd) * 100).toFixed(2))
              : 0,
          limit_exceeded: previous.today_cost_usd > response.daily_limit_usd,
        };
        onUsageStateChange?.(updatedSummary);
        return updatedSummary;
      });
      onShowToast(response.message, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update daily limit.";
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

      {isLoading && !summary && !todaySummary ? (
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
              {todaySummary ? <span>{formatCurrency(todaySummary.today_cost_usd)} / {formatCurrency(todaySummary.daily_limit_usd)}</span> : null}
            </div>
            <div className="nc-cost-progress" aria-label="Daily usage progress bar">
              <div
                className={`nc-cost-progress__fill ${todaySummary?.limit_exceeded ? "nc-cost-progress__fill--danger" : todaySummary && todaySummary.percentage_used >= 80 ? "nc-cost-progress__fill--warning" : ""}`}
                style={{ width: `${Math.min(todaySummary?.percentage_used ?? 0, 100)}%` }}
              />
            </div>
            <div className="nc-cost-card__meta">
              <span>{Math.round(todaySummary?.percentage_used ?? 0)}%</span>
              <span>Warning at 80%</span>
            </div>
          </section>

          <div className="nc-cost-summary-grid">
            <section className="nc-cost-card">
              <p className="nc-cost-section-label">This month</p>
              <h3>{formatCurrency(currentMonthStats.thisMonthCostUsd)}</h3>
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

          <LimitSetter
            dailyLimitUsd={todaySummary?.daily_limit_usd ?? 1}
            isSaving={isSavingLimit}
            onSave={handleSaveDailyLimit}
          />

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
      <button type="button" className="nc-cost-panel__backdrop" onClick={onClose} aria-label="Close cost dashboard" />
      <aside className="nc-cost-panel" aria-label="Cost dashboard" data-testid="cost-dashboard-panel">
        <div className="nc-cost-panel__header">
          <div>
            <p className="nc-cost-section-label">Cost monitoring</p>
            <h2>Usage and spend</h2>
          </div>
          <button type="button" className="nc-cost-panel__close" onClick={onClose}>Close</button>
        </div>
        <CostDashboardContent
          getAuthToken={getAuthToken}
          naming={naming}
          onShowToast={onShowToast}
          onUsageStateChange={onUsageStateChange}
        />
      </aside>
    </>
  );
}
