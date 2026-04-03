import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  authState,
  getTokenMock,
  generateConversationTitleMock,
  createAgentPlanMock,
  runAgentMock,
  confirmAgentActionMock,
  getAgentHistoryMock,
  getAgentTaskMock,
} = vi.hoisted(() => ({
  authState: { signedIn: true },
  getTokenMock: vi.fn().mockResolvedValue("token"),
  generateConversationTitleMock: vi.fn().mockResolvedValue({ title: "Python AI Research" }),
  createAgentPlanMock: vi.fn().mockResolvedValue({
    plan_id: "plan-1",
    goal: "Research top Python AI libraries",
    mode: "research",
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
        mode: "research",
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
  confirmAgentActionMock: vi.fn(),
  getAgentHistoryMock: vi.fn().mockResolvedValue([]),
  getAgentTaskMock: vi.fn().mockResolvedValue({ plan: { plan_id: "plan-1", goal: "Test", steps: [] }, log: [] }),
}));

vi.mock("@clerk/clerk-react", () => ({
  SignedIn: ({ children }: { children: React.ReactNode }) => (authState.signedIn ? children : null),
  SignedOut: ({ children }: { children: React.ReactNode }) => (authState.signedIn ? null : children),
  SignIn: () => <div>Clerk Sign In</div>,
  useAuth: () => ({ userId: "user_1", getToken: getTokenMock }),
  useUser: () => ({
    isLoaded: true,
    user: {
      fullName: "Abdul Hanan",
      firstName: "Abdul",
      username: "hanan",
      primaryEmailAddress: { emailAddress: "hanan@example.com" },
    },
  }),
  useClerk: () => ({ signOut: vi.fn(), openUserProfile: vi.fn() }),
}));

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
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
  };
});

vi.mock("../api/agent", () => ({
  createAgentPlan: createAgentPlanMock,
  runAgent: runAgentMock,
  confirmAgentAction: confirmAgentActionMock,
  getAgentHistory: getAgentHistoryMock,
  getAgentTask: getAgentTaskMock,
}));

vi.mock("../hooks/useAccess", () => ({
  useAccess: () => ({
    role: "owner",
    roleLabel: "Owner",
    access: {
      role: "owner",
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
      usage_limits: {
        daily_limit_usd: 1,
        monthly_limit_usd: 30,
      },
      email: "hanan@example.com",
      display_name: "Abdul Hanan",
      seeded_owner: false,
    },
    features: [
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
    isOwner: true,
    can: () => true,
    hasFeature: () => true,
    isLoaded: true,
    limits: null,
  }),
}));

import App from "../App";

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <App />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

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
    renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Toggle Agent Mode" }));
    expect(screen.getByPlaceholderText("Describe a goal for the agent...")).toBeInTheDocument();
  });

  it("test_agent_toggle_switches_back_to_normal_chat", async () => {
    renderApp();
    const toggle = screen.getByRole("button", { name: "Toggle Agent Mode" });
    await userEvent.click(toggle);
    await userEvent.click(toggle);
    expect(screen.getByPlaceholderText("Message NeuralChat...")).toBeInTheDocument();
  });

  it("test_agent_progress_shows_plan_steps_on_load", async () => {
    renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Toggle Agent Mode" }));
    await userEvent.type(screen.getByPlaceholderText("Describe a goal for the agent..."), "Research top Python AI libraries");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("Search libraries")).toBeInTheDocument();
    expect(screen.getByText("Summarize findings")).toBeInTheDocument();
    expect(screen.getByText("Write final answer")).toBeInTheDocument();
    expect(screen.getByText("Research")).toBeInTheDocument();
  });

  it("test_agent_progress_shows_coding_mode_badge", async () => {
    createAgentPlanMock.mockResolvedValueOnce({
      plan_id: "plan-code",
      goal: "Debug App.tsx errors",
      mode: "coding",
      steps: [
        { step_number: 1, description: "Inspect repo files", tool: "inspect_repo", tool_input: '{"path":"frontend/src"}' },
      ],
    });

    renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Toggle Agent Mode" }));
    await userEvent.type(screen.getByPlaceholderText("Describe a goal for the agent..."), "Debug App.tsx errors");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("Coding")).toBeInTheDocument();
    expect(screen.getByText("Inspect repo files")).toBeInTheDocument();
  });

  it("test_agent_progress_step_status_updates_correctly", async () => {
    renderApp();
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

    renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Toggle Agent Mode" }));
    await userEvent.type(screen.getByPlaceholderText("Describe a goal for the agent..."), "Research");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    await userEvent.click(await screen.findByRole("button", { name: "Run plan" }));

    expect(await screen.findByText("Failed")).toBeInTheDocument();
  });

  it("test_agent_progress_streams_final_summary", async () => {
    renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Toggle Agent Mode" }));
    await userEvent.type(screen.getByPlaceholderText("Describe a goal for the agent..."), "Research");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    await userEvent.click(await screen.findByRole("button", { name: "Run plan" }));

    await waitFor(() => {
      expect(screen.getByText("Final summary")).toBeInTheDocument();
    });
  });

  it("test_agent_progress_requests_confirmation_for_workspace_write_actions", async () => {
    runAgentMock.mockImplementationOnce(async (_token, _planId, _sessionId, callbacks) => {
      callbacks.onPlan?.({
        plan_id: "plan-1",
        goal: "Create a launch workspace",
        steps: [
          {
            step_number: 1,
            description: "Create the launch project",
            tool: "create_project",
            tool_input: '{"name":"Launch Pad"}',
          },
        ],
      });
      callbacks.onConfirmationRequired?.({
        step_number: 1,
        description: "Create the launch project",
        action_type: "create_project",
        action_label: "Create project",
        action_payload: { name: "Launch Pad" },
        risk_note: "This will add a new project to the workspace.",
      });
    });
    confirmAgentActionMock.mockImplementationOnce(async (_token, _planId, payload, callbacks) => {
      callbacks.onStepDone?.({
        step_number: payload.step_number,
        description: "Create the launch project",
        tool: "create_project",
        tool_input: '{"name":"Launch Pad"}',
        result: "Created project 'Launch Pad'.",
        status: payload.approved ? "approved" : "rejected",
        error: null,
      });
      callbacks.onDone?.({ plan_id: "plan-1", steps_completed: 1 });
    });

    renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Toggle Agent Mode" }));
    await userEvent.type(screen.getByPlaceholderText("Describe a goal for the agent..."), "Create a launch workspace");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    await userEvent.click(await screen.findByRole("button", { name: "Run plan" }));

    expect(await screen.findByText("Workspace action requested")).toBeInTheDocument();
    expect(screen.getByText("Create project")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Confirm action" }));

    await waitFor(() => {
      expect(confirmAgentActionMock).toHaveBeenCalledWith(
        "token",
        "plan-1",
        {
          session_id: expect.any(String),
          step_number: 1,
          approved: true,
        },
        expect.any(Object),
        undefined,
        expect.any(Object)
      );
    });
  });

  it("test_agent_progress_shows_loop_warning", async () => {
    runAgentMock.mockImplementationOnce(async (_token, _planId, _sessionId, callbacks) => {
      callbacks.onWarning?.("Agent stopped: repeated tool calls detected");
      callbacks.onDone?.({ plan_id: "plan-1", steps_completed: 1 });
    });

    renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Toggle Agent Mode" }));
    await userEvent.type(screen.getByPlaceholderText("Describe a goal for the agent..."), "Research");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    await userEvent.click(await screen.findByRole("button", { name: "Run plan" }));

    expect(await screen.findByText(/Agent stopped: repeated tool calls detected/i)).toBeInTheDocument();
  });

  it("test_agent_history_panel_opens_on_robot_icon_click", async () => {
    renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Open agent history" }));
    expect(await screen.findByTestId("agent-history-panel")).toBeInTheDocument();
  });

  it("test_agent_history_lists_past_tasks", async () => {
    getAgentHistoryMock.mockResolvedValueOnce([
      { plan_id: "1", goal: "Goal one", created_at: "2026-03-12T00:00:00Z", steps_count: 2 },
      { plan_id: "2", goal: "Goal two", created_at: "2026-03-12T00:00:00Z", steps_count: 3 },
    ]);

    renderApp();
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

    renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Open agent history" }));
    await userEvent.click(await screen.findByRole("button", { name: /Goal one/i }));

    expect(await screen.findByText("Search")).toBeInTheDocument();
  });

  it("test_agent_history_shows_empty_state", async () => {
    getAgentHistoryMock.mockResolvedValueOnce([]);
    renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Open agent history" }));
    expect(await screen.findByText(/No agent tasks yet/i)).toBeInTheDocument();
  });
});
