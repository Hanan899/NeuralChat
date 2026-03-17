import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MessageBubble } from "./MessageBubble";
import { SearchSources } from "./SearchSources";

const {
  authState,
  getTokenMock,
  checkSearchStatusMock,
  streamChatMock,
  getFilesMock,
  deleteFileMock,
  uploadFileWithProgressMock,
  generateConversationTitleMock,
  createAgentPlanMock,
  runAgentMock,
  getAgentHistoryMock,
  getAgentTaskMock,
} = vi.hoisted(() => ({
  authState: { signedIn: true },
  getTokenMock: vi.fn().mockResolvedValue("token"),
  checkSearchStatusMock: vi.fn().mockResolvedValue(true),
  streamChatMock: vi.fn().mockResolvedValue({
    requestId: "req-1",
    responseMs: 10,
    firstTokenMs: 5,
    tokensEmitted: 1,
    searchUsed: false,
    fileContextUsed: false,
    sources: []
  }),
  getFilesMock: vi.fn().mockResolvedValue({ files: [] }),
  deleteFileMock: vi.fn().mockResolvedValue({ message: "deleted" }),
  uploadFileWithProgressMock: vi.fn().mockResolvedValue({
    filename: "doc.txt",
    blob_path: "user/sess/doc.txt",
    chunk_count: 1,
    message: "File uploaded successfully"
  }),
  generateConversationTitleMock: vi.fn().mockResolvedValue({ title: "Search Results Review" }),
  createAgentPlanMock: vi.fn(),
  runAgentMock: vi.fn(),
  getAgentHistoryMock: vi.fn().mockResolvedValue([]),
  getAgentTaskMock: vi.fn().mockResolvedValue({ plan: { plan_id: "plan-1", goal: "Goal", steps: [] }, log: [] }),
}));

vi.mock("../api", () => ({
  checkHealth: vi.fn().mockResolvedValue(true),
  checkSearchStatus: checkSearchStatusMock,
  streamChat: streamChatMock,
  getFiles: getFilesMock,
  deleteFile: deleteFileMock,
  deleteConversationSession: vi.fn().mockResolvedValue({
    message: "Conversation deleted successfully",
    conversation_deleted: true,
    uploads_deleted: 0,
    parsed_deleted: 0,
    plans_deleted: 0,
    logs_deleted: 0,
  }),
  uploadFileWithProgress: uploadFileWithProgressMock,
  generateConversationTitle: generateConversationTitleMock
}));

vi.mock("../api/agent", () => ({
  createAgentPlan: createAgentPlanMock,
  runAgent: runAgentMock,
  getAgentHistory: getAgentHistoryMock,
  getAgentTask: getAgentTaskMock,
}));

vi.mock("@clerk/clerk-react", () => ({
  SignedIn: ({ children }: { children: React.ReactNode }) => (authState.signedIn ? children : null),
  SignedOut: ({ children }: { children: React.ReactNode }) => (authState.signedIn ? null : children),
  SignIn: () => <div>Clerk Sign In</div>,
  UserButton: () => <div>UserButton</div>,
  useAuth: () => ({
    userId: "user_1",
    getToken: getTokenMock
  }),
  useUser: () => ({
    user: {
      fullName: "Abdul Hanan",
      firstName: "Abdul",
      username: "hanan",
      primaryEmailAddress: {
        emailAddress: "hanan@example.com"
      }
    }
  }),
  useClerk: () => ({
    signOut: vi.fn(),
    openUserProfile: vi.fn()
  })
}));

import App from "../App";

describe("SearchSources and MessageBubble", () => {
  const sources = [
    { title: "OpenAI", url: "https://openai.com", snippet: "AI company" },
    { title: "Azure", url: "https://azure.microsoft.com", snippet: "Cloud platform" },
    { title: "Tavily", url: "https://tavily.com", snippet: "Search API" }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    checkSearchStatusMock.mockResolvedValue(true);
    authState.signedIn = true;
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    });
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
        showAssistantLabel={true}
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
        showAssistantLabel={true}
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

  it("shows typing cursor while assistant stream is active", () => {
    const { container } = render(
      <MessageBubble
        isStreaming={true}
        message={{
          id: "msg-typing",
          role: "assistant",
          content: "Streaming reply",
          createdAt: new Date().toISOString(),
          model: "gpt-5",
          searchUsed: false,
          sources: []
        }}
      />
    );

    expect(container.querySelector(".typing-cursor")).toBeInTheDocument();
  });

  it("renders the user message even when attached files are present", () => {
    render(
      <MessageBubble
        message={{
          id: "msg-user-files",
          role: "user",
          content: "Please use these files.",
          createdAt: new Date().toISOString(),
          model: "gpt-5",
          attachedFiles: [
            { filename: "brief.pdf", uploaded_at: "", blob_path: "user/session/brief.pdf" },
            { filename: "notes.txt", uploaded_at: "", blob_path: "user/session/notes.txt" }
          ]
        }}
      />
    );

    expect(screen.getByText("Please use these files.")).toBeInTheDocument();
  });

  it("renders code block header with copy behavior", async () => {
    render(
      <MessageBubble
        message={{
          id: "msg-code",
          role: "assistant",
          content: "```js\nconsole.log('hello')\n```",
          createdAt: new Date().toISOString(),
          model: "gpt-5"
        }}
      />
    );

    expect(screen.getByText("js")).toBeInTheDocument();
    const copyButton = screen.getByRole("button", { name: "Copy" });
    await userEvent.click(copyButton);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Copied ✓" })).toBeInTheDocument();
    });
  });

  it("shows message action buttons for assistant", () => {
    render(
      <MessageBubble
        message={{
          id: "msg-actions",
          role: "assistant",
          content: "Action row",
          createdAt: new Date().toISOString(),
          model: "gpt-5"
        }}
      />
    );

    expect(screen.getByRole("button", { name: "Thumbs up" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thumbs down" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy message" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry response" })).toBeInTheDocument();
  });

  it("shows copied state after copy action", async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    });

    render(
      <MessageBubble
        message={{
          id: "msg-copy",
          role: "assistant",
          content: "Copy me",
          createdAt: new Date().toISOString(),
          model: "gpt-5"
        }}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Copy message" }));
    expect(screen.getByText("Copied to clipboard")).toBeInTheDocument();
  });

  it("toggles helpful feedback state", async () => {
    render(
      <MessageBubble
        message={{
          id: "msg-feedback",
          role: "assistant",
          content: "Feedback me",
          createdAt: new Date().toISOString(),
          model: "gpt-5"
        }}
      />
    );

    const thumbsUpButton = screen.getByRole("button", { name: "Thumbs up" });
    await userEvent.click(thumbsUpButton);
    expect(thumbsUpButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Marked helpful")).toBeInTheDocument();
  });

  it("test_search_status_badge_green_when_enabled", async () => {
    checkSearchStatusMock.mockResolvedValue(true);
    render(<App />);

    const webSearchToggle = await screen.findByRole("button", { name: "Toggle Web Search Mode" });
    expect(webSearchToggle).toBeInTheDocument();
    expect(screen.getByText("Web search")).toBeInTheDocument();
    expect(within(webSearchToggle).getByText("Off")).toBeInTheDocument();
  });

  it("test_search_status_badge_grey_when_disabled", async () => {
    checkSearchStatusMock.mockResolvedValue(false);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Toggle Web Search Mode" })).toBeInTheDocument();
    });

    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });
});
