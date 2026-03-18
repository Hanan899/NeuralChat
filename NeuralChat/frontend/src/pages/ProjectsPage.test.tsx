import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectsPage } from "./ProjectsPage";

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

describe("ProjectsPage", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the template gallery when no projects exist", () => {
    render(
      <ProjectsPage
        authToken="token"
        templates={templates}
        projects={[]}
        isLoading={false}
        errorText=""
        onRefresh={vi.fn()}
        onOpenProject={vi.fn()}
      />
    );

    expect(screen.getByText("Welcome to Projects")).toBeInTheDocument();
    expect(screen.getByText("Startup Builder")).toBeInTheDocument();
    expect(screen.getByText("Custom Project")).toBeInTheDocument();
  });

  it("shows the project grid when projects exist", () => {
    render(
      <ProjectsPage
        authToken="token"
        templates={templates}
        projects={[
          {
            project_id: "proj-1",
            name: "My Startup",
            description: "Building NeuralChat",
            emoji: "🚀",
            template: "startup",
            color: "#6366f1",
            system_prompt: "Prompt",
            created_at: "2026-03-17T10:00:00Z",
            updated_at: "2026-03-17T10:00:00Z",
            chat_count: 3,
            pinned: true,
          },
          {
            project_id: "proj-2",
            name: "Learn Python",
            description: "",
            emoji: "📚",
            template: "study",
            color: "#10b981",
            system_prompt: "Prompt",
            created_at: "2026-03-17T10:00:00Z",
            updated_at: "2026-03-15T10:00:00Z",
            chat_count: 1,
            pinned: false,
          },
        ]}
        isLoading={false}
        errorText=""
        onRefresh={vi.fn()}
        onOpenProject={vi.fn()}
      />
    );

    expect(screen.getByText("My Startup")).toBeInTheDocument();
    expect(screen.getByText("3 chats")).toBeInTheDocument();
    expect(screen.getByText("Learn Python")).toBeInTheDocument();
    expect(screen.getByText("1 chat")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /new project/i })).toHaveLength(2);
  });

  it("opens a project when its card is clicked", async () => {
    const onOpenProject = vi.fn();
    render(
      <ProjectsPage
        authToken="token"
        templates={templates}
        projects={[
          {
            project_id: "proj-1",
            name: "My Startup",
            description: "Building NeuralChat",
            emoji: "🚀",
            template: "startup",
            color: "#6366f1",
            system_prompt: "Prompt",
            created_at: "2026-03-17T10:00:00Z",
            updated_at: "2026-03-17T10:00:00Z",
            chat_count: 3,
            pinned: false,
          },
        ]}
        isLoading={false}
        errorText=""
        onRefresh={vi.fn()}
        onOpenProject={onOpenProject}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /my startup/i }));
    expect(onOpenProject).toHaveBeenCalledWith("proj-1");
  });
});
