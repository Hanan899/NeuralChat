import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useAccessMock } = vi.hoisted(() => ({
  useAccessMock: vi.fn(() => ({
    role: "owner" as const,
    roleLabel: "Owner",
    access: {
      role: "owner" as const,
      role_label: "Owner",
      is_owner: true,
      feature_overrides: {},
      effective_features: [
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
      ],
      usage_limits: { daily_limit_usd: 1, monthly_limit_usd: 30 },
    },
    can: () => true,
    isOwner: true,
    isLoaded: true,
    isFetching: false,
    userId: "user_1",
    refetch: vi.fn(),
  })),
}));

vi.mock("../hooks/useAccess", () => ({
  useAccess: useAccessMock,
}));

import { CostDashboard } from "./CostDashboard";
import { CostWarningBanner } from "./CostWarningBanner";

const {
  getUsageStatusMock,
  getUsageSummaryMock,
  updateUsageLimitMock,
} = vi.hoisted(() => ({
  getUsageStatusMock: vi.fn(),
  getUsageSummaryMock: vi.fn(),
  updateUsageLimitMock: vi.fn(),
}));

vi.mock("../api/usage", () => ({
  getUsageStatus: getUsageStatusMock,
  getUsageSummary: getUsageSummaryMock,
  updateUsageLimit: updateUsageLimitMock,
}));

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="chart-container">{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => <div />,
  Line: () => <div />,
  CartesianGrid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const usageStatusResponse = {
  daily: {
    spent_usd: 0.23,
    limit_usd: 1.0,
    remaining_usd: 0.77,
    warning_triggered: false,
    limit_exceeded: false,
    percentage_used: 23,
  },
  monthly: {
    spent_usd: 4.2,
    limit_usd: 30.0,
    remaining_usd: 25.8,
    warning_triggered: false,
    limit_exceeded: false,
    percentage_used: 14,
  },
  blocked: false,
  blocking_period: null,
  blocking_message: "",
};

const summaryResponse = {
  total_cost_usd: 0.75,
  total_input_tokens: 150000,
  total_output_tokens: 45000,
  by_feature: {
    chat: { cost_usd: 0.3, calls: 4, input_tokens: 1000, output_tokens: 500 },
    memory: { cost_usd: 0.05, calls: 2, input_tokens: 200, output_tokens: 80 },
    search_decision: { cost_usd: 0.02, calls: 1, input_tokens: 100, output_tokens: 20 },
    agent_plan: { cost_usd: 0.04, calls: 1, input_tokens: 140, output_tokens: 30 },
    agent_step: { cost_usd: 0.03, calls: 2, input_tokens: 220, output_tokens: 45 },
    agent_summary: { cost_usd: 0.01, calls: 1, input_tokens: 80, output_tokens: 12 },
    title_generation: { cost_usd: 0, calls: 0, input_tokens: 0, output_tokens: 0 },
  },
  daily_costs: [
    { date: "2026-03-11", cost_usd: 0.02 },
    { date: "2026-03-12", cost_usd: 0.12 },
    { date: "2026-03-13", cost_usd: 0.08 },
    { date: "2026-03-14", cost_usd: 0.05 },
    { date: "2026-03-15", cost_usd: 0.16 },
    { date: "2026-03-16", cost_usd: 0.2 },
    { date: "2026-03-17", cost_usd: 0.12 },
  ],
};

function renderDashboard() {
  const testQueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return render(
    <QueryClientProvider client={testQueryClient}>
      <CostDashboard
        isOpen
        onClose={vi.fn()}
        getAuthToken={vi.fn().mockResolvedValue("token")}
        onShowToast={vi.fn()}
        onUsageStateChange={vi.fn()}
        naming={{ userDisplayName: "Abdul Hanan", sessionTitle: "Chat" }}
      />
    </QueryClientProvider>
  );
}

describe("CostDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUsageStatusMock.mockResolvedValue(usageStatusResponse);
    getUsageSummaryMock.mockResolvedValue(summaryResponse);
    updateUsageLimitMock.mockResolvedValue({
      message: "Daily limit updated to $2.00",
      daily_limit_usd: 2.0,
      monthly_limit_usd: 30.0,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("test_cost_dashboard_renders_todays_cost", async () => {
    renderDashboard();
    expect(await screen.findByText("$0.230 / $1.00")).toBeInTheDocument();
  });

  it("test_cost_dashboard_renders_progress_bar", async () => {
    getUsageStatusMock.mockResolvedValueOnce({
      ...usageStatusResponse,
      daily: { ...usageStatusResponse.daily, spent_usd: 0.5, remaining_usd: 0.5, percentage_used: 50 },
    });

    renderDashboard();
    expect(await screen.findByText("50%")).toBeInTheDocument();
  });

  it("test_cost_dashboard_renders_feature_breakdown", async () => {
    renderDashboard();

    const breakdown = await screen.findByTestId("cost-feature-breakdown");
    expect(within(breakdown).getByText("Chat")).toBeInTheDocument();
    expect(within(breakdown).getByText("Memory")).toBeInTheDocument();
  });

  it("test_cost_dashboard_renders_daily_chart", async () => {
    renderDashboard();
    expect(await screen.findByTestId("cost-daily-chart")).toBeInTheDocument();
  });

  it("test_cost_warning_banner_hidden_below_80_percent", () => {
    render(<CostWarningBanner status={usageStatusResponse} onDismiss={vi.fn()} />);
    expect(screen.queryByText(/budget warning/i)).not.toBeInTheDocument();
  });

  it("test_cost_warning_banner_shows_daily_warning_at_80_percent", () => {
    render(
      <CostWarningBanner
        status={{
          ...usageStatusResponse,
          daily: {
            ...usageStatusResponse.daily,
            spent_usd: 0.8,
            remaining_usd: 0.2,
            percentage_used: 80,
            warning_triggered: true,
          },
        }}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.getByText(/Daily budget warning/i)).toBeInTheDocument();
    expect(screen.getByText(/80% of your daily budget/i)).toBeInTheDocument();
  });

  it("test_cost_warning_banner_shows_monthly_warning", () => {
    render(
      <CostWarningBanner
        status={{
          ...usageStatusResponse,
          monthly: {
            ...usageStatusResponse.monthly,
            spent_usd: 24,
            remaining_usd: 6,
            percentage_used: 80,
            warning_triggered: true,
          },
        }}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.getByText(/Monthly budget warning/i)).toBeInTheDocument();
  });

  it("test_cost_warning_banner_dismissable", async () => {
    function BannerHarness() {
      const [visible, setVisible] = useState(true);
      return visible ? (
        <CostWarningBanner
          status={{
            ...usageStatusResponse,
            daily: {
              ...usageStatusResponse.daily,
              spent_usd: 0.8,
              remaining_usd: 0.2,
              percentage_used: 80,
              warning_triggered: true,
            },
          }}
          onDismiss={() => setVisible(false)}
        />
      ) : null;
    }

    render(<BannerHarness />);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss cost warning" }));
    await waitFor(() => {
      expect(screen.queryByText(/Daily budget warning/i)).not.toBeInTheDocument();
    });
  });

  it("test_limit_setter_shows_current_limits", async () => {
    renderDashboard();
    expect((await screen.findAllByText("$1.00")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("$30.00").length).toBeGreaterThan(0);
  });

  it("test_limit_setter_saves_new_daily_limit", async () => {
    renderDashboard();
    const panel = await screen.findByTestId("cost-dashboard-panel");

    await userEvent.click(within(panel).getAllByRole("button", { name: "Edit" })[0]);
    const input = within(panel).getByLabelText("Daily limit");
    await userEvent.clear(input);
    await userEvent.type(input, "2.00");
    await userEvent.click(within(panel).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateUsageLimitMock).toHaveBeenCalledWith(
        "token",
        { daily_limit_usd: 2 },
        { userDisplayName: "Abdul Hanan", sessionTitle: "Chat" }
      );
    });
  });

  it("test_limit_setter_shows_success_toast", async () => {
    const onShowToast = vi.fn();
    const testQueryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    render(
      <QueryClientProvider client={testQueryClient}>
        <CostDashboard
          isOpen
          onClose={vi.fn()}
          getAuthToken={vi.fn().mockResolvedValue("token")}
          onShowToast={onShowToast}
          onUsageStateChange={vi.fn()}
          naming={{ userDisplayName: "Abdul Hanan", sessionTitle: "Chat" }}
        />
      </QueryClientProvider>
    );
    const panel = await screen.findByTestId("cost-dashboard-panel");

    await userEvent.click(within(panel).getAllByRole("button", { name: "Edit" })[0]);
    const input = within(panel).getByLabelText("Daily limit");
    await userEvent.clear(input);
    await userEvent.type(input, "2.00");
    await userEvent.click(within(panel).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onShowToast).toHaveBeenCalledWith("Daily limit updated to $2.00", "success");
    });
  });

  it("test_dashboard_auto_refreshes_every_60_seconds", async () => {
    vi.useFakeTimers();
    renderDashboard();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getUsageStatusMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getUsageStatusMock).toHaveBeenCalledTimes(2);
  });
});
