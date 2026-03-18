import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreateProjectModal } from "./CreateProjectModal";

const { createProjectMock } = vi.hoisted(() => ({
  createProjectMock: vi.fn(),
}));

vi.mock("../api/projects", () => ({
  createProject: createProjectMock,
}));

const templates = {
  startup: {
    emoji: "🚀",
    color: "#6366f1",
    label: "Startup Builder",
    description: "Build, plan, and grow your startup",
    system_prompt: "You are my startup advisor.",
    memory_keys: ["startup_name", "tech_stack"],
  },
  study: {
    emoji: "📚",
    color: "#10b981",
    label: "Study Assistant",
    description: "Master any subject or skill",
    system_prompt: "You are my study assistant.",
    memory_keys: ["subject", "current_level"],
  },
  code: {
    emoji: "💻",
    color: "#3b82f6",
    label: "Code Reviewer",
    description: "Review and improve code quality",
    system_prompt: "You are my code reviewer.",
    memory_keys: ["language"],
  },
  writing: {
    emoji: "✍️",
    color: "#f59e0b",
    label: "Writing Partner",
    description: "Write, edit, and improve documents",
    system_prompt: "You are my writing partner.",
    memory_keys: ["tone"],
  },
  research: {
    emoji: "🔍",
    color: "#8b5cf6",
    label: "Research Hub",
    description: "Research, summarize, and organize topics",
    system_prompt: "You are my research analyst.",
    memory_keys: ["research_topic"],
  },
  job: {
    emoji: "💼",
    color: "#ec4899",
    label: "Job Search",
    description: "Plan and execute your job search",
    system_prompt: "You are my career coach.",
    memory_keys: ["target_role"],
  },
  custom: {
    emoji: "✨",
    color: "#6b7280",
    label: "Custom Project",
    description: "Build your own custom workspace",
    system_prompt: "You are my custom assistant.",
    memory_keys: [],
  },
};

describe("CreateProjectModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the selected template summary instead of a template picker", () => {
    render(
      <CreateProjectModal
        open={true}
        authToken="token"
        templates={templates}
        initialTemplate="code"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />
    );

    expect(screen.getAllByText("Code Reviewer").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /study assistant/i })).not.toBeInTheDocument();
  });

  it("uses the selected template to prefill description and show a template summary", () => {
    render(
      <CreateProjectModal
        open={true}
        authToken="token"
        templates={templates}
        initialTemplate="study"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />
    );

    expect(screen.getByRole("textbox", { name: /description/i })).toHaveValue("Master any subject or skill");
    expect(screen.getAllByText("Study Assistant").length).toBeGreaterThan(0);
    expect(screen.queryByText("subject")).not.toBeInTheDocument();
  });

  it("disables create button until name is provided and updates preview", async () => {
    render(
      <CreateProjectModal
        open={true}
        authToken="token"
        templates={templates}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />
    );

    const createButton = screen.getByRole("button", { name: /create project/i });
    expect(createButton).toBeDisabled();

    await userEvent.type(screen.getByRole("textbox", { name: /name your project/i }), "My Startup");

    expect(screen.getByText("My Startup")).toBeInTheDocument();
    expect(createButton).not.toBeDisabled();
  });

  it("calls createProject with the selected template and redirects through onCreated", async () => {
    const onCreated = vi.fn();
    createProjectMock.mockResolvedValue({
      project_id: "proj-1",
      name: "Test Project",
      template: "study",
      emoji: "📚",
      color: "#10b981",
    });

    render(
      <CreateProjectModal
        open={true}
        authToken="token"
        templates={templates}
        initialTemplate="study"
        naming={{ userDisplayName: "Ali Khan" }}
        onClose={vi.fn()}
        onCreated={onCreated}
      />
    );

    await userEvent.clear(screen.getByRole("textbox", { name: /name your project/i }));
    await userEvent.type(screen.getByRole("textbox", { name: /name your project/i }), "Test Project");
    await userEvent.click(screen.getByRole("button", { name: /create project/i }));

    await waitFor(() => {
      expect(createProjectMock).toHaveBeenCalledWith(
        "token",
        expect.objectContaining({ name: "Test Project", template: "study" }),
        { userDisplayName: "Ali Khan" }
      );
    });
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ project_id: "proj-1" }));
  });

  it("can create a project by resolving a fresh auth token at submit time", async () => {
    const onCreated = vi.fn();
    const getAuthToken = vi.fn().mockResolvedValue("fresh-token");
    createProjectMock.mockResolvedValue({
      project_id: "proj-2",
      name: "ChatAssist AI",
      template: "custom",
      emoji: "✨",
      color: "#6b7280",
    });

    render(
      <CreateProjectModal
        open={true}
        authToken=""
        getAuthToken={getAuthToken}
        templates={templates}
        onClose={vi.fn()}
        onCreated={onCreated}
      />
    );

    await userEvent.type(screen.getByRole("textbox", { name: /name your project/i }), "ChatAssist AI");
    await userEvent.click(screen.getByRole("button", { name: /create project/i }));

    await waitFor(() => {
      expect(getAuthToken).toHaveBeenCalled();
      expect(createProjectMock).toHaveBeenCalledWith(
        "fresh-token",
        expect.objectContaining({ name: "ChatAssist AI", template: "startup" }),
        undefined
      );
    });
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ project_id: "proj-2" }));
  });

  it("shows a friendly error when a fresh auth token still cannot be resolved", async () => {
    const getAuthToken = vi.fn().mockResolvedValue(null);

    render(
      <CreateProjectModal
        open={true}
        authToken=""
        getAuthToken={getAuthToken}
        templates={templates}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />
    );

    await userEvent.type(screen.getByRole("textbox", { name: /name your project/i }), "ChatAssist AI");
    await userEvent.click(screen.getByRole("button", { name: /create project/i }));

    await waitFor(() => {
      expect(screen.getByText("We couldn't confirm your session yet. Please wait a second and try again.")).toBeInTheDocument();
    });
    expect(createProjectMock).not.toHaveBeenCalled();
  });
});
