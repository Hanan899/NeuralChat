import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MessageBubble } from "./MessageBubble";
import { SearchSources } from "./SearchSources";

const { authState, getTokenMock, checkSearchStatusMock, streamChatMock } = vi.hoisted(() => ({
  authState: { signedIn: true },
  getTokenMock: vi.fn().mockResolvedValue("token"),
  checkSearchStatusMock: vi.fn().mockResolvedValue(true),
  streamChatMock: vi.fn().mockResolvedValue({
    requestId: "req-1",
    responseMs: 10,
    firstTokenMs: 5,
    tokensEmitted: 1,
    searchUsed: false,
    sources: []
  })
}));

vi.mock("../api", () => ({
  checkHealth: vi.fn().mockResolvedValue(true),
  checkSearchStatus: checkSearchStatusMock,
  streamChat: streamChatMock
}));

vi.mock("@clerk/clerk-react", () => ({
  SignedIn: ({ children }: { children: React.ReactNode }) => (authState.signedIn ? children : null),
  SignedOut: ({ children }: { children: React.ReactNode }) => (authState.signedIn ? null : children),
  SignIn: () => <div>Clerk Sign In</div>,
  UserButton: () => <div>UserButton</div>,
  useAuth: () => ({
    userId: "user_1",
    getToken: getTokenMock
  })
}));

import App from "../App";

describe("SearchSources", () => {
  const sources = [
    { title: "OpenAI", url: "https://openai.com", snippet: "AI company" },
    { title: "Azure", url: "https://azure.microsoft.com", snippet: "Cloud platform" },
    { title: "Tavily", url: "https://tavily.com", snippet: "Search API" }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    checkSearchStatusMock.mockResolvedValue(true);
    authState.signedIn = true;
  });

  afterEach(() => {
    cleanup();
  });

  it("test_search_sources_renders_all_sources", async () => {
    render(<SearchSources sources={sources} />);

    await userEvent.click(screen.getByRole("button", { name: /sources/i }));

    expect(screen.getByText("OpenAI")).toBeInTheDocument();
    expect(screen.getByText("Azure")).toBeInTheDocument();
    expect(screen.getByText("Tavily")).toBeInTheDocument();
  });

  it("test_search_sources_collapsed_by_default", () => {
    render(<SearchSources sources={sources} />);

    expect(screen.queryByText("AI company")).not.toBeInTheDocument();
    expect(screen.queryByText("Cloud platform")).not.toBeInTheDocument();
  });

  it("test_search_sources_expands_on_click", async () => {
    render(<SearchSources sources={sources} />);

    await userEvent.click(screen.getByRole("button", { name: /sources/i }));

    expect(screen.getByText("AI company")).toBeInTheDocument();
    expect(screen.getByText("Cloud platform")).toBeInTheDocument();
  });

  it("test_search_sources_renders_clickable_links", async () => {
    render(<SearchSources sources={[{ title: "Example", url: "https://example.com", snippet: "Snippet" }]} />);

    await userEvent.click(screen.getByRole("button", { name: /sources/i }));

    const link = screen.getByRole("link", { name: "Example" });
    expect(link).toHaveAttribute("href", "https://example.com");
  });

  it("test_globe_badge_shows_on_message_with_search_used", () => {
    render(
      <MessageBubble
        message={{
          id: "msg-1",
          role: "assistant",
          content: "Here is your answer",
          createdAt: new Date().toISOString(),
          model: "gpt-5",
          searchUsed: true,
          sources
        }}
      />
    );

    expect(screen.getByLabelText("Search used")).toBeInTheDocument();
  });

  it("test_globe_badge_hidden_on_message_without_search", () => {
    render(
      <MessageBubble
        message={{
          id: "msg-2",
          role: "assistant",
          content: "No search answer",
          createdAt: new Date().toISOString(),
          model: "gpt-5",
          searchUsed: false,
          sources: []
        }}
      />
    );

    expect(screen.queryByLabelText("Search used")).not.toBeInTheDocument();
  });

  it("test_search_status_badge_green_when_enabled", async () => {
    checkSearchStatusMock.mockResolvedValue(true);
    render(<App />);

    const indicator = await screen.findByLabelText("Web search enabled");
    expect(indicator).toBeInTheDocument();
    expect(indicator.className).toContain("bg-green-500");
  });

  it("test_search_status_badge_grey_when_disabled", async () => {
    checkSearchStatusMock.mockResolvedValue(false);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByLabelText("Web search disabled")).toBeInTheDocument();
    });

    const indicator = screen.getByLabelText("Web search disabled");
    expect(indicator.className).toContain("bg-slate-400");
    expect(indicator).toHaveAttribute("title", "Web search disabled — add TAVILY_API_KEY");
  });
});
