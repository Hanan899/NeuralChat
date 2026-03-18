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

  it("shows all 7 template cards", () => {
    render(
      <CreateProjectModal
        open={true}
        authToken="token"
        templates={templates}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />
    );

    expect(screen.getByText("Startup Builder")).toBeInTheDocument();
    expect(screen.getByText("Study Assistant")).toBeInTheDocument();
    expect(screen.getByText("Code Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Writing Partner")).toBeInTheDocument();
    expect(screen.getByText("Research Hub")).toBeInTheDocument();
    expect(screen.getByText("Job Search")).toBeInTheDocument();
    expect(screen.getByText("Custom Project")).toBeInTheDocument();
  });

  it("selecting a template prefills description and memory keys", async () => {
    render(
      <CreateProjectModal
        open={true}
        authToken="token"
        templates={templates}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /study assistant/i }));

    expect(screen.getByRole("textbox", { name: /describe it/i })).toHaveValue("Master any subject or skill");
    expect(screen.getByText("subject")).toBeInTheDocument();
    expect(screen.getByText("current_level")).toBeInTheDocument();
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
        naming={{ userDisplayName: "Ali Khan" }}
        onClose={vi.fn()}
        onCreated={onCreated}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /study assistant/i }));
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
});
