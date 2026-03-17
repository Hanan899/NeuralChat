import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  authState,
  getTokenMock,
  generateConversationTitleMock,
  createAgentPlanMock,
  runAgentMock,
  getAgentHistoryMock,
  getAgentTaskMock,
} = vi.hoisted(() => ({
  authState: { signedIn: true },
  getTokenMock: vi.fn().mockResolvedValue("token"),
  generateConversationTitleMock: vi.fn().mockResolvedValue({ title: "Python AI Research" }),
  createAgentPlanMock: vi.fn().mockResolvedValue({
    plan_id: "plan-1",
    goal: "Research top Python AI libraries",
    steps: [
      { step_number: 1, description: "Search libraries", tool: "web_search", tool_input: "Python AI libraries" },
      { step_number: 2, description: "Summarize findings", tool: null, tool_input: null },
      { step_number: 3, description: "Write final answer", tool: null, tool_input: null },
    ],
  }),
  runAgentMock: vi.fn().mockImplementation(async (_token, _planId, _sessionId, callbacks) => {
    callbacks.onPlan?.({
      plan_id: "plan-1",
      goal: "Research top Python AI libraries",
      steps: [
        { step_number: 1, description: "Search libraries", tool: "web_search", tool_input: "Python AI libraries" },
      ],
    });
    callbacks.onStepStart?.({ step_number: 1, description: "Search libraries" });
    callbacks.onStepDone?.({ step_number: 1, description: "", tool: null, tool_input: null, result: "LangChain", status: "done", error: null });
    callbacks.onSummaryToken?.("Final ");
    callbacks.onSummaryToken?.("summary");
    callbacks.onDone?.({ plan_id: "plan-1", steps_completed: 1 });
  }),
  getAgentHistoryMock: vi.fn().mockResolvedValue([]),
  getAgentTaskMock: vi.fn().mockResolvedValue({ plan: { plan_id: "plan-1", goal: "Test", steps: [] }, log: [] }),
}));

vi.mock("@clerk/clerk-react", () => ({
  SignedIn: ({ children }: { children: React.ReactNode }) => (authState.signedIn ? children : null),
  SignedOut: ({ children }: { children: React.ReactNode }) => (authState.signedIn ? null : children),
  SignIn: () => <div>Clerk Sign In</div>,
  useAuth: () => ({ userId: "user_1", getToken: getTokenMock }),
  useUser: () => ({
    user: {
      fullName: "Abdul Hanan",
      firstName: "Abdul",
      username: "hanan",
      primaryEmailAddress: { emailAddress: "hanan@example.com" },
    },
  }),
  useClerk: () => ({ signOut: vi.fn(), openUserProfile: vi.fn() }),
}));

vi.mock("../api", () => ({
  checkHealth: vi.fn().mockResolvedValue(true),
  checkSearchStatus: vi.fn().mockResolvedValue(true),
  generateConversationTitle: generateConversationTitleMock,
  streamChat: vi.fn().mockResolvedValue({ requestId: "req-1", responseMs: 10, firstTokenMs: 5, tokensEmitted: 1, searchUsed: false, fileContextUsed: false, sources: [] }),
  getFiles: vi.fn().mockResolvedValue({ files: [] }),
  deleteFile: vi.fn().mockResolvedValue({ message: "deleted" }),
  deleteConversationSession: vi.fn().mockResolvedValue({
    message: "Conversation deleted successfully",
    conversation_deleted: true,
    uploads_deleted: 0,
    parsed_deleted: 0,
    plans_deleted: 0,
    logs_deleted: 0,
  }),
  uploadFileWithProgress: vi.fn().mockResolvedValue({ filename: "doc.txt", blob_path: "path", chunk_count: 1, message: "ok" }),
}));

vi.mock("../api/agent", () => ({
  createAgentPlan: createAgentPlanMock,
  runAgent: runAgentMock,
  getAgentHistory: getAgentHistoryMock,
  getAgentTask: getAgentTaskMock,
}));

import App from "../App";

describe("Agent mode UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.signedIn = true;
    getTokenMock.mockResolvedValue("token");
    getAgentHistoryMock.mockResolvedValue([]);
    getAgentTaskMock.mockResolvedValue({ plan: { plan_id: "plan-1", goal: "Test", steps: [] }, log: [] });
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("test_agent_toggle_switches_to_agent_mode", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Toggle Agent Mode" }));
    expect(screen.getByPlaceholderText("Describe a goal for the agent...")).toBeInTheDocument();
  });

  it("test_agent_toggle_switches_back_to_normal_chat", async () => {
    render(<App />);
    const toggle = screen.getByRole("button", { name: "Toggle Agent Mode" });
    await userEvent.click(toggle);
    await userEvent.click(toggle);
    expect(screen.getByPlaceholderText("Message NeuralChat...")).toBeInTheDocument();
  });

  it("test_agent_progress_shows_plan_steps_on_load", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Toggle Agent Mode" }));
    await userEvent.type(screen.getByPlaceholderText("Describe a goal for the agent..."), "Research top Python AI libraries");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("Search libraries")).toBeInTheDocument();
    expect(screen.getByText("Summarize findings")).toBeInTheDocument();
    expect(screen.getByText("Write final answer")).toBeInTheDocument();
  });

  it("test_agent_progress_step_status_updates_correctly", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Toggle Agent Mode" }));
    await userEvent.type(screen.getByPlaceholderText("Describe a goal for the agent..."), "Research");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    await userEvent.click(await screen.findByRole("button", { name: "Run plan" }));

    expect(await screen.findByText("Done")).toBeInTheDocument();
  });

  it("test_agent_progress_shows_failed_step_correctly", async () => {
    runAgentMock.mockImplementationOnce(async (_token, _planId, _sessionId, callbacks) => {
      callbacks.onStepStart?.({ step_number: 1, description: "Search libraries" });
      callbacks.onStepDone?.({ step_number: 1, description: "", tool: null, tool_input: null, result: "", status: "failed", error: "Search failed" });
      callbacks.onDone?.({ plan_id: "plan-1", steps_completed: 1 });
    });

    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Toggle Agent Mode" }));
    await userEvent.type(screen.getByPlaceholderText("Describe a goal for the agent..."), "Research");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    await userEvent.click(await screen.findByRole("button", { name: "Run plan" }));

    expect(await screen.findByText("Failed")).toBeInTheDocument();
  });

  it("test_agent_progress_streams_final_summary", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Toggle Agent Mode" }));
    await userEvent.type(screen.getByPlaceholderText("Describe a goal for the agent..."), "Research");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    await userEvent.click(await screen.findByRole("button", { name: "Run plan" }));

    await waitFor(() => {
      expect(screen.getByText("Final summary")).toBeInTheDocument();
    });
  });

  it("test_agent_progress_shows_loop_warning", async () => {
    runAgentMock.mockImplementationOnce(async (_token, _planId, _sessionId, callbacks) => {
      callbacks.onWarning?.("Agent stopped: repeated tool calls detected");
      callbacks.onDone?.({ plan_id: "plan-1", steps_completed: 1 });
    });

    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Toggle Agent Mode" }));
    await userEvent.type(screen.getByPlaceholderText("Describe a goal for the agent..."), "Research");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    await userEvent.click(await screen.findByRole("button", { name: "Run plan" }));

    expect(await screen.findByText(/Agent stopped: repeated tool calls detected/i)).toBeInTheDocument();
  });

  it("test_agent_history_panel_opens_on_robot_icon_click", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Open agent history" }));
    expect(await screen.findByTestId("agent-history-panel")).toBeInTheDocument();
  });

  it("test_agent_history_lists_past_tasks", async () => {
    getAgentHistoryMock.mockResolvedValueOnce([
      { plan_id: "1", goal: "Goal one", created_at: "2026-03-12T00:00:00Z", steps_count: 2 },
      { plan_id: "2", goal: "Goal two", created_at: "2026-03-12T00:00:00Z", steps_count: 3 },
    ]);

    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Open agent history" }));

    expect(await screen.findByText("Goal one")).toBeInTheDocument();
    expect(screen.getByText("Goal two")).toBeInTheDocument();
  });

  it("test_agent_history_expands_task_on_click", async () => {
    getAgentHistoryMock.mockResolvedValueOnce([{ plan_id: "1", goal: "Goal one", created_at: "2026-03-12T00:00:00Z", steps_count: 2 }]);
    getAgentTaskMock.mockResolvedValueOnce({
      plan: { plan_id: "1", goal: "Goal one", steps: [] },
      log: [{ step_number: 1, description: "Search", tool: "web_search", tool_input: "AI", result: "done", status: "done", error: null }],
    });

    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Open agent history" }));
    await userEvent.click(await screen.findByRole("button", { name: /Goal one/i }));

    expect(await screen.findByText("Search")).toBeInTheDocument();
  });

  it("test_agent_history_shows_empty_state", async () => {
    getAgentHistoryMock.mockResolvedValueOnce([]);
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Open agent history" }));
    expect(await screen.findByText(/No agent tasks yet/i)).toBeInTheDocument();
  });
});
