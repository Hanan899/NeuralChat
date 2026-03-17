import { useState } from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CostDashboard } from "./CostDashboard";
import { CostWarningBanner } from "./CostWarningBanner";

const {
  getTodayUsageMock,
  getUsageSummaryMock,
  getUsageLimitMock,
  updateUsageLimitMock,
} = vi.hoisted(() => ({
  getTodayUsageMock: vi.fn(),
  getUsageSummaryMock: vi.fn(),
  getUsageLimitMock: vi.fn(),
  updateUsageLimitMock: vi.fn(),
}));

vi.mock("../api/usage", () => ({
  getTodayUsage: getTodayUsageMock,
  getUsageSummary: getUsageSummaryMock,
  getUsageLimit: getUsageLimitMock,
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

const todayResponse = {
  records: [],
  summary: {
    today_cost_usd: 0.23,
    daily_limit_usd: 1.0,
    limit_exceeded: false,
    percentage_used: 23,
  },
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
  return render(
    <CostDashboard
      isOpen
      onClose={vi.fn()}
      getAuthToken={vi.fn().mockResolvedValue("token")}
      onShowToast={vi.fn()}
      onUsageStateChange={vi.fn()}
      naming={{ userDisplayName: "Abdul Hanan", sessionTitle: "Chat" }}
    />
  );
}

describe("CostDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTodayUsageMock.mockResolvedValue(todayResponse);
    getUsageSummaryMock.mockResolvedValue(summaryResponse);
    getUsageLimitMock.mockResolvedValue({ daily_limit_usd: 1.0 });
    updateUsageLimitMock.mockResolvedValue({ message: "Daily limit updated to $2.00", daily_limit_usd: 2.0 });
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
    getTodayUsageMock.mockResolvedValueOnce({
      records: [],
      summary: { today_cost_usd: 0.5, daily_limit_usd: 1.0, limit_exceeded: false, percentage_used: 50 },
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
    render(
      <CostWarningBanner
        summary={{ today_cost_usd: 0.5, daily_limit_usd: 1.0, percentage_used: 50, limit_exceeded: false }}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.queryByText(/Usage warning/i)).not.toBeInTheDocument();
  });

  it("test_cost_warning_banner_shows_at_80_percent", () => {
    render(
      <CostWarningBanner
        summary={{ today_cost_usd: 0.8, daily_limit_usd: 1.0, percentage_used: 80, limit_exceeded: false }}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.getByText(/You've used 80% of your daily budget/i)).toBeInTheDocument();
  });

  it("test_cost_warning_banner_dismissable", async () => {
    function BannerHarness() {
      const [visible, setVisible] = useState(true);
      return visible ? (
        <CostWarningBanner
          summary={{ today_cost_usd: 0.8, daily_limit_usd: 1.0, percentage_used: 80, limit_exceeded: false }}
          onDismiss={() => setVisible(false)}
        />
      ) : null;
    }

    render(<BannerHarness />);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss cost warning" }));
    await waitFor(() => {
      expect(screen.queryByText(/Usage warning/i)).not.toBeInTheDocument();
    });
  });

  it("test_limit_setter_shows_current_limit", async () => {
    renderDashboard();
    expect(await screen.findByText("$1.00")).toBeInTheDocument();
  });

  it("test_limit_setter_saves_new_limit", async () => {
    renderDashboard();
    const panel = await screen.findByTestId("cost-dashboard-panel");

    await userEvent.click(within(panel).getByRole("button", { name: "Edit" }));
    const input = within(panel).getByLabelText("Daily limit");
    await userEvent.clear(input);
    await userEvent.type(input, "2.00");
    await userEvent.click(within(panel).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateUsageLimitMock).toHaveBeenCalledWith("token", 2, {
        userDisplayName: "Abdul Hanan",
        sessionTitle: "Chat",
      });
    });
  });

  it("test_limit_setter_shows_success_toast", async () => {
    const onShowToast = vi.fn();
    render(
      <CostDashboard
        isOpen
        onClose={vi.fn()}
        getAuthToken={vi.fn().mockResolvedValue("token")}
        onShowToast={onShowToast}
        onUsageStateChange={vi.fn()}
        naming={{ userDisplayName: "Abdul Hanan", sessionTitle: "Chat" }}
      />
    );
    const panel = await screen.findByTestId("cost-dashboard-panel");

    await userEvent.click(within(panel).getByRole("button", { name: "Edit" }));
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
    expect(getTodayUsageMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getTodayUsageMock).toHaveBeenCalledTimes(2);
  });
});
