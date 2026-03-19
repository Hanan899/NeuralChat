import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectWorkspacePage } from "./ProjectWorkspacePage";

vi.mock("../api/projects", () => ({
  updateProject: vi.fn(),
}));

vi.mock("../components/ProjectBrainPanel", () => ({
  ProjectBrainPanel: () => <div>Project Brain</div>,
}));

const baseProject = {
  project_id: "proj-1",
  name: "My Startup",
  description: "Building NeuralChat",
  emoji: "🚀",
  template: "startup",
  color: "#6366f1",
  system_prompt: "You are my startup advisor.",
  created_at: "2026-03-17T10:00:00Z",
  updated_at: "2026-03-17T10:00:00Z",
  chat_count: 2,
  pinned: false,
};

describe("ProjectWorkspacePage", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows project name, chats, Project Brain, and files", () => {
    render(
      <ProjectWorkspacePage
        authToken="token"
        project={baseProject}
        templates={{}}
        chats={[
          { session_id: "chat-1", created_at: "2026-03-17T10:00:00Z", message_count: 3, last_message_preview: "PRD discussion" },
          { session_id: "chat-2", created_at: "2026-03-17T11:00:00Z", message_count: 1, last_message_preview: "Investor pitch" },
        ]}
        brainData={{
          memory: { startup_name: "NeuralChat", tech_stack: "FastAPI" },
          completeness: { percentage: 40, filled_keys: ["startup_name", "tech_stack"], missing_keys: ["target_users"], suggestion: "Tell me about your target users." },
        }}
        files={[{ filename: "pitch-deck.pdf", blob_path: "blob", uploaded_at: "2026-03-17T12:00:00Z" }]}
        onBack={vi.fn()}
        onOpenChat={vi.fn()}
        onDeleteChat={vi.fn()}
        onCreateChat={vi.fn()}
        onRefresh={vi.fn()}
        onProjectUpdated={vi.fn()}
        onDeleteProject={vi.fn()}
        onTogglePin={vi.fn()}
        onUploadFile={vi.fn()}
      />
    );

    expect(screen.getByText("My Startup")).toBeInTheDocument();
    expect(screen.getByText("PRD discussion")).toBeInTheDocument();
    expect(screen.getByText("Project Brain")).toBeInTheDocument();
    expect(screen.getByText("pitch-deck.pdf")).toBeInTheDocument();
  });

  it("opens a chat and creates a new chat from the workspace controls", async () => {
    const onOpenChat = vi.fn();
    const onCreateChat = vi.fn();
    const onDeleteChat = vi.fn();

    render(
      <ProjectWorkspacePage
        authToken="token"
        project={baseProject}
        templates={{}}
        chats={[{ session_id: "chat-1", created_at: "2026-03-17T10:00:00Z", message_count: 3, last_message_preview: "PRD discussion" }]}
        brainData={null}
        files={[]}
        onBack={vi.fn()}
        onOpenChat={onOpenChat}
        onDeleteChat={onDeleteChat}
        onCreateChat={onCreateChat}
        onRefresh={vi.fn()}
        onProjectUpdated={vi.fn()}
        onDeleteProject={vi.fn()}
        onTogglePin={vi.fn()}
        onUploadFile={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /\+ new chat/i }));
    expect(onCreateChat).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: /^prd discussion/i }));
    expect(onOpenChat).toHaveBeenCalledWith("chat-1");

    await userEvent.click(screen.getByRole("button", { name: /delete prd discussion/i }));
    expect(onDeleteChat).toHaveBeenCalledWith("chat-1");
  });

  it("goes back to the projects list", async () => {
    const onBack = vi.fn();
    render(
      <ProjectWorkspacePage
        authToken="token"
        project={baseProject}
        templates={{}}
        chats={[]}
        brainData={null}
        files={[]}
        onBack={onBack}
        onOpenChat={vi.fn()}
        onDeleteChat={vi.fn()}
        onCreateChat={vi.fn()}
        onRefresh={vi.fn()}
        onProjectUpdated={vi.fn()}
        onDeleteProject={vi.fn()}
        onTogglePin={vi.fn()}
        onUploadFile={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /projects/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
