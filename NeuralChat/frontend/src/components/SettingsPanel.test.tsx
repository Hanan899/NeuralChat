import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

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

import { SettingsPanel } from "./SettingsPanel";

vi.mock("./CostDashboard", () => ({
  CostDashboardContent: () => <div data-testid="cost-dashboard-content">Cost dashboard</div>,
}));

describe("SettingsPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("opens on the general section by default", () => {
    render(
      <SettingsPanel
        getAuthToken={vi.fn().mockResolvedValue("token")}
        onShowToast={vi.fn()}
        onOpenAccountSettings={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "General" })).toBeInTheDocument();
    expect(screen.getByText("General controls")).toBeInTheDocument();
  });

  it("lets users switch to account and run its action", async () => {
    const onOpenAccountSettings = vi.fn();

    render(
      <SettingsPanel
        getAuthToken={vi.fn().mockResolvedValue("token")}
        onShowToast={vi.fn()}
        onOpenAccountSettings={onOpenAccountSettings}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /account/i }));
    await userEvent.click(screen.getByRole("button", { name: /open account settings/i }));

    expect(onOpenAccountSettings).toHaveBeenCalledTimes(1);
  });

  it("lets users use a general action", async () => {
    const onShowToast = vi.fn();

    render(
      <SettingsPanel
        getAuthToken={vi.fn().mockResolvedValue("token")}
        onShowToast={onShowToast}
        onOpenAccountSettings={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /where is theme\\?/i }));

    expect(onShowToast).toHaveBeenCalledWith("Theme is available in the top bar.", "info");
  });
});
