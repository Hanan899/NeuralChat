import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  authState,
  getTokenMock,
  streamChatMock,
  checkSearchStatusMock,
  getFilesMock,
  deleteFileMock,
  deleteConversationSessionMock,
  uploadFileWithProgressMock,
  generateConversationTitleMock,
  createAgentPlanMock,
  runAgentMock,
  getAgentHistoryMock,
  getAgentTaskMock,
} = vi.hoisted(() => ({
  authState: { signedIn: true },
  getTokenMock: vi.fn().mockResolvedValue("token"),
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
  deleteConversationSessionMock: vi.fn().mockResolvedValue({
    message: "Conversation deleted successfully",
    conversation_deleted: true,
    uploads_deleted: 0,
    parsed_deleted: 0,
    plans_deleted: 0,
    logs_deleted: 0,
  }),
  uploadFileWithProgressMock: vi.fn().mockResolvedValue({
    filename: "doc.txt",
    blob_path: "user/sess/doc.txt",
    chunk_count: 1,
    message: "File uploaded successfully"
  }),
  generateConversationTitleMock: vi.fn().mockResolvedValue({ title: "Greeting Chat" }),
  checkSearchStatusMock: vi.fn().mockResolvedValue(false),
  createAgentPlanMock: vi.fn(),
  runAgentMock: vi.fn(),
  getAgentHistoryMock: vi.fn().mockResolvedValue([]),
  getAgentTaskMock: vi.fn().mockResolvedValue({ plan: { plan_id: "plan-1", goal: "Goal", steps: [] }, log: [] })
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

vi.mock("../api", () => ({
  checkHealth: vi.fn().mockResolvedValue(true),
  checkSearchStatus: checkSearchStatusMock,
  streamChat: streamChatMock,
  getFiles: getFilesMock,
  deleteFile: deleteFileMock,
  deleteConversationSession: deleteConversationSessionMock,
  uploadFileWithProgress: uploadFileWithProgressMock,
  generateConversationTitle: generateConversationTitleMock
}));

vi.mock("../api/agent", () => ({
  createAgentPlan: createAgentPlanMock,
  runAgent: runAgentMock,
  getAgentHistory: getAgentHistoryMock,
  getAgentTask: getAgentTaskMock
}));

import App from "../App";

describe("App", () => {
  beforeEach(() => {
    authState.signedIn = true;
    getTokenMock.mockResolvedValue("token");
    streamChatMock.mockResolvedValue({
      requestId: "req-1",
      responseMs: 10,
      firstTokenMs: 5,
      tokensEmitted: 1,
      searchUsed: false,
      fileContextUsed: false,
      sources: []
    });
    checkSearchStatusMock.mockResolvedValue(false);
    deleteConversationSessionMock.mockResolvedValue({
      message: "Conversation deleted successfully",
      conversation_deleted: true,
      uploads_deleted: 0,
      parsed_deleted: 0,
      plans_deleted: 0,
      logs_deleted: 0,
    });
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders login screen when signed out", () => {
    authState.signedIn = false;
    render(<App />);

    expect(screen.getAllByText("NeuralChat").length).toBeGreaterThan(0);
    expect(screen.getByText("Clerk Sign In")).toBeInTheDocument();
  });

  it("renders sidebar groups and empty state", async () => {
    render(<App />);

    expect(await screen.findByText("Your chats")).toBeInTheDocument();
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.getByText("How can I help you today?")).toBeInTheDocument();
  });

  it("sends bearer-authenticated chat request", async () => {
    render(<App />);

    await userEvent.type(screen.getByPlaceholderText("Message NeuralChat..."), "hello");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(getTokenMock).toHaveBeenCalled();
    expect(streamChatMock).toHaveBeenCalledTimes(1);
    const [, tokenArg, , , namingArg] = streamChatMock.mock.calls[0];
    expect(tokenArg).toBe("token");
    expect(namingArg).toEqual({
      userDisplayName: "Abdul Hanan",
      sessionTitle: "Hello",
    });
  });

  it("opens sidebar from mobile menu button", async () => {
    render(<App />);
    const sidebar = await screen.findByTestId("conversation-sidebar");

    await userEvent.click(screen.getByRole("button", { name: "Open sidebar" }));
    expect(sidebar.className).toContain("nc-sidebar--open");
  });

  it("shows stop generating while stream is active", async () => {
    streamChatMock.mockImplementation(
      (_payload, _authToken, _onChunk, signal: AbortSignal | undefined) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("Generation stopped by user.")));
        })
    );

    render(<App />);

    await userEvent.type(screen.getByPlaceholderText("Message NeuralChat..."), "stream");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByRole("button", { name: "Stop generating" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Stop generating" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send message" })).toBeInTheDocument();
    });
  });

  it("prevents duplicate submit when Enter and form submit fire together", async () => {
    streamChatMock.mockImplementation(
      () =>
        new Promise(() => {
          // Keep the stream pending so repeated submissions would stack if not locked.
        })
    );

    render(<App />);
    const textarea = screen.getByPlaceholderText("Message NeuralChat...");
    await userEvent.type(textarea, "hello");

    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });
    fireEvent.submit(textarea.closest("form") as HTMLFormElement);

    await waitFor(() => {
      expect(streamChatMock).toHaveBeenCalledTimes(1);
    });
  });

  it("removes empty assistant placeholder when stream fails before first token", async () => {
    streamChatMock.mockRejectedValue(new Error("Azure OpenAI streaming request failed: 400."));

    const { container } = render(<App />);

    await userEvent.type(screen.getByPlaceholderText("Message NeuralChat..."), "hello");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(screen.getByText("Azure OpenAI streaming request failed: 400.")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(container.querySelectorAll(".nc-message--user")).toHaveLength(1);
      expect(container.querySelectorAll(".nc-message--assistant")).toHaveLength(0);
    });
  });

  it("deletes the conversation in backend before removing it locally", async () => {
    render(<App />);

    await userEvent.type(screen.getByPlaceholderText("Message NeuralChat..."), "hello");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));

    await userEvent.click(await screen.findByRole("button", { name: /Open actions for Hello/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete chat" }));

    await waitFor(() => {
      expect(deleteConversationSessionMock).toHaveBeenCalledWith("token", expect.any(String), {
        userDisplayName: "Abdul Hanan",
        sessionTitle: "Hello",
      });
    });
  });
});
