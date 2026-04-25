import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
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

import { Sidebar } from "./Sidebar";

afterEach(() => {
  cleanup();
});

function renderSidebar(overrides: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  const baseProps: React.ComponentProps<typeof Sidebar> = {
    historyItems: [
      {
        id: "conversation-1",
        title: "Test chat",
        preview: "",
        updatedAt: new Date().toISOString()
      }
    ],
    archivedHistoryItems: [],
    activeConversationId: "conversation-1",
    isMobileOpen: false,
    userName: "Hanan",
    userSubtitle: "hanan@example.com",
    themeMode: "system",
    isWebSearchMode: false,
    isWebSearchAvailable: true,
    onNewChat: vi.fn(),
    onSelectConversation: vi.fn(),
    onToggleArchiveConversation: vi.fn(),
    onDeleteConversation: vi.fn(),
    onShareConversation: vi.fn(),
    onToggleWebSearchMode: vi.fn(),
    onThemeModeChange: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenUserSettings: vi.fn(),
    onSignOut: vi.fn(),
    onCloseMobile: vi.fn(),
    onToggleCollapse: vi.fn()
  };

  return render(<Sidebar {...baseProps} {...overrides} />);
}

describe("Sidebar", () => {
  it("opens the actions menu and triggers share", async () => {
    const onShareConversation = vi.fn();
    renderSidebar({ onShareConversation });

    await userEvent.click(screen.getByRole("button", { name: /open actions for test chat/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /share chat/i }));

    expect(onShareConversation).toHaveBeenCalledWith("conversation-1");
  });

  it("triggers archive from the three-dot menu", async () => {
    const onToggleArchiveConversation = vi.fn();
    renderSidebar({ onToggleArchiveConversation });

    await userEvent.click(screen.getByRole("button", { name: /open actions for test chat/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /archive chat/i }));

    expect(onToggleArchiveConversation).toHaveBeenCalledWith("conversation-1");
  });

  it("triggers delete from the three-dot menu", async () => {
    const onDeleteConversation = vi.fn();
    renderSidebar({ onDeleteConversation });

    await userEvent.click(screen.getByRole("button", { name: /open actions for test chat/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /delete chat/i }));

    expect(onDeleteConversation).toHaveBeenCalledWith("conversation-1");
  });

  it("opens the user menu and triggers settings and account actions", async () => {
    const onOpenSettings = vi.fn();
    const onOpenUserSettings = vi.fn();
    const onSignOut = vi.fn();

    renderSidebar({ onOpenSettings, onOpenUserSettings, onSignOut });

    await userEvent.click(screen.getByRole("button", { name: "More options" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Settings" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "More options" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /manage account/i }));
    expect(onOpenUserSettings).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "More options" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("opens the user menu from the avatar in collapsed mode", async () => {
    const onOpenSettings = vi.fn();
    renderSidebar({ isCollapsed: true, onOpenSettings });

    await userEvent.click(screen.getByRole("button", { name: /open user menu/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Settings" }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("changes theme from the user menu", async () => {
    const onThemeModeChange = vi.fn();
    renderSidebar({ themeMode: "system", onThemeModeChange });

    await userEvent.click(screen.getByRole("button", { name: "More options" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: /dark/i }));

    expect(onThemeModeChange).toHaveBeenCalledWith("dark");
  });

  it("toggles web search mode from the sidebar subitem", async () => {
    const onToggleWebSearchMode = vi.fn();
    renderSidebar({ onToggleWebSearchMode });

    await userEvent.click(screen.getByRole("button", { name: "Toggle Web Search Mode" }));

    expect(onToggleWebSearchMode).toHaveBeenCalledTimes(1);
  });

  it("shows the recents heading", () => {
    renderSidebar();

    expect(screen.getByRole("heading", { name: "Recents" })).toBeInTheDocument();
  });

  it("triggers the agent mode shortcut and marks it active", async () => {
    const onOpenAgentMode = vi.fn();
    renderSidebar({ onOpenAgentMode, activeShortcutId: "agent" });

    const agentButton = screen.getByRole("button", { name: "Agent mode" });
    await userEvent.click(agentButton);

    expect(onOpenAgentMode).toHaveBeenCalledTimes(1);
    expect(agentButton).toHaveAttribute("aria-current", "page");
  });

  it("toggles the sidebar pane button", async () => {
    const onToggleCollapse = vi.fn();
    renderSidebar({ onToggleCollapse });

    await userEvent.click(screen.getByRole("button", { name: /collapse sidebar/i }));

    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it("renders project subitems under Projects and opens a project", async () => {
    const onOpenProject = vi.fn();
    const onCreateProject = vi.fn();
    renderSidebar({
      projects: [
        {
          project_id: "proj-1",
          name: "NeuralChat Startup",
          description: "",
          emoji: "🚀",
          template: "startup",
          color: "#6366f1",
          system_prompt: "Prompt",
          created_at: "2026-03-17T10:00:00Z",
          updated_at: "2026-03-17T10:00:00Z",
          chat_count: 2,
          pinned: false,
        },
      ],
      activeShortcutId: "projects",
      activeProjectId: "proj-1",
      onCreateProject,
      onOpenProject,
    });

    await userEvent.click(screen.getByRole("button", { name: /new project/i }));
    expect(onCreateProject).toHaveBeenCalledTimes(1);

    const projectButton = screen.getByRole("button", { name: /neuralchat startup/i });
    expect(projectButton).toHaveAttribute("aria-current", "page");

    await userEvent.click(projectButton);
    expect(onOpenProject).toHaveBeenCalledWith("proj-1");
  });
});
