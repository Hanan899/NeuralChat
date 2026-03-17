import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
    isAgentMode: false,
    onNewChat: vi.fn(),
    onSelectConversation: vi.fn(),
    onToggleArchiveConversation: vi.fn(),
    onDeleteConversation: vi.fn(),
    onShareConversation: vi.fn(),
    onToggleWebSearchMode: vi.fn(),
    onToggleAgentMode: vi.fn(),
    onThemeModeChange: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenUserSettings: vi.fn(),
    onSignOut: vi.fn(),
    onCloseMobile: vi.fn()
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

  it("toggles agent mode from the sidebar subitem", async () => {
    const onToggleAgentMode = vi.fn();
    renderSidebar({ onToggleAgentMode });

    await userEvent.click(screen.getByRole("button", { name: "Toggle Agent Mode" }));

    expect(onToggleAgentMode).toHaveBeenCalledTimes(1);
  });
});
