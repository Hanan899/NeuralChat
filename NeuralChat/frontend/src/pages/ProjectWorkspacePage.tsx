import { useState } from "react";

import { useAccess } from "../hooks/useAccess";
import type { UploadedFileItem } from "../types";
import { EditSystemPromptModal } from "../components/EditSystemPromptModal";
import { ProjectBrainPanel } from "../components/ProjectBrainPanel";
import { ProjectTemplateIcon } from "../components/ProjectTemplateIcon";
import type { Project, ProjectChat, ProjectMemoryResponse, ProjectTemplate } from "../types/project";

interface ProjectWorkspacePageProps {
  authToken: string;
  getAuthToken?: () => Promise<string | null>;
  project: Project;
  templates: Record<string, ProjectTemplate>;
  chats: ProjectChat[];
  brainData?: ProjectMemoryResponse | null;
  files: UploadedFileItem[];
  naming?: { userDisplayName?: string; sessionTitle?: string };
  onBack: () => void;
  onOpenLatestChat: () => void;
  onOpenChat: (sessionId: string) => void;
  onDeleteChat: (sessionId: string) => void;
  onCreateChat: () => void;
  onRefresh: () => Promise<void> | void;
  onProjectUpdated: (project: Project) => void;
  onDeleteProject: () => void;
  onTogglePin: () => void;
  onUploadFile: () => void;
  isRefreshing?: boolean;
}

export function ProjectWorkspacePage({
  authToken,
  getAuthToken,
  project,
  templates,
  chats,
  brainData,
  files,
  naming,
  onBack,
  onOpenLatestChat,
  onOpenChat,
  onDeleteChat,
  onCreateChat,
  onRefresh,
  onProjectUpdated,
  onDeleteProject,
  onTogglePin,
  onUploadFile,
  isRefreshing = false,
}: ProjectWorkspacePageProps) {
  const { can } = useAccess();
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false);
  const templateLabel = templates[project.template]?.label ?? "Custom Project";
  const latestChat = chats[0] ?? null;

  return (
    <section className="nc-project-workspace" data-testid="project-workspace-page">
      <header className="nc-project-workspace__header" style={{ ["--project-color" as string]: project.color }}>
        <button type="button" className="nc-button nc-button--ghost" onClick={onBack}>
          ← Projects
        </button>

        <div className="nc-project-workspace__header-copy">
          <div className="nc-project-workspace__title-row">
            <ProjectTemplateIcon template={project.template} color={project.color} className="nc-project-workspace__icon" />
            <h2>{project.name}</h2>
          </div>
          <div className="nc-project-workspace__meta-row">
            <span className="nc-project-workspace__template-badge">{templateLabel}</span>
            {project.pinned ? <span className="nc-project-workspace__template-badge nc-project-workspace__template-badge--quiet">Pinned</span> : null}
            {isRefreshing ? <span className="nc-project-workspace__template-badge nc-project-workspace__template-badge--status">Refreshing...</span> : null}
          </div>
          <p className="nc-project-workspace__summary">
            {project.description?.trim() || templates[project.template]?.description || "Manage this workspace, its memory, and reusable files."}
          </p>
          <div className="nc-project-workspace__workspace-note">
            <span>{chats.length} chat{chats.length === 1 ? "" : "s"}</span>
            <span>{files.length} file{files.length === 1 ? "" : "s"}</span>
            <span>Project Brain + files refresh in the background</span>
          </div>
        </div>

        <div className="nc-project-workspace__header-actions">
          <button type="button" className="nc-button nc-button--primary" onClick={onOpenLatestChat}>
            {latestChat ? "Open latest chat" : "Start first chat"}
          </button>
          <button type="button" className="nc-button nc-button--ghost" onClick={() => setIsPromptModalOpen(true)} disabled={!can("memory:write")}>
            Edit prompt
          </button>
          <div className="nc-project-options">
            <button type="button" className="nc-button nc-button--ghost" onClick={() => setIsOptionsOpen((value) => !value)}>
              ⋯ Options
            </button>
            {isOptionsOpen ? (
              <div className="nc-project-options__menu">
                <button type="button" onClick={() => { setIsOptionsOpen(false); onTogglePin(); }}>
                  {project.pinned ? "Unpin project" : "Pin project"}
                </button>
                <button type="button" onClick={() => { setIsOptionsOpen(false); setIsPromptModalOpen(true); }} disabled={!can("memory:write")}>
                  Edit system prompt
                </button>
                <button type="button" className="nc-project-options__danger" onClick={() => { setIsOptionsOpen(false); onDeleteProject(); }} disabled={!can("project:delete")}>
                  Delete project
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="nc-project-workspace__grid">
        <section className="nc-project-panel">
          <div className="nc-project-panel__header">
            <h3>
              <span className="nc-project-panel__title-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M6 8.5C6 6.57 7.57 5 9.5 5H14.5C16.43 5 18 6.57 18 8.5V12.2C18 14.13 16.43 15.7 14.5 15.7H11L7.6 18.2V15.4C6.68 14.78 6 13.73 6 12.5V8.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                </svg>
              </span>
              Chats
            </h3>
            <button type="button" className="nc-button nc-button--ghost" onClick={onCreateChat}>+ New Chat</button>
          </div>
          {chats.length === 0 ? (
            <div className="nc-project-panel__empty">No project chats yet. Start the first one.</div>
          ) : (
            <div className="nc-project-chat-list">
              {chats.map((chat) => (
                <div key={chat.session_id} className="nc-project-chat-row">
                  <button type="button" className="nc-project-chat-row__main" onClick={() => onOpenChat(chat.session_id)}>
                    <strong>{chat.title || chat.last_message_preview || "Untitled chat"}</strong>
                    <span>{chat.message_count} messages</span>
                  </button>
                  {can("project:delete") ? (
                    <button
                      type="button"
                      className="nc-project-chat-row__delete"
                      aria-label={`Delete ${chat.title || chat.last_message_preview || "Untitled chat"}`}
                      onClick={() => onDeleteChat(chat.session_id)}
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>

        <ProjectBrainPanel
          authToken={authToken}
          getAuthToken={getAuthToken}
          projectId={project.project_id}
          template={project.template}
          naming={naming}
          initialData={brainData}
        />

        <section className="nc-project-panel nc-project-panel--files">
          <div className="nc-project-panel__header">
            <h3>
              <span className="nc-project-panel__title-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M4 8C4 6.9 4.9 6 6 6H10.5L12.5 8H18C19.1 8 20 8.9 20 10V17C20 18.1 19.1 19 18 19H6C4.9 19 4 18.1 4 17V8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                </svg>
              </span>
              Project Files
            </h3>
            <button type="button" className="nc-button nc-button--ghost" onClick={onUploadFile} disabled={!can("file:upload")}>+ Upload file</button>
          </div>
          {files.length === 0 ? (
            <div className="nc-project-panel__empty">No project files yet. Upload documents once and reuse them across every project chat.</div>
          ) : (
            <div className="nc-project-file-grid">
              {files.map((file) => (
                <div key={file.blob_path} className="nc-project-file-chip">
                  <strong>{file.filename}</strong>
                  <span>{file.uploaded_at ? new Date(file.uploaded_at).toLocaleDateString() : "Ready"}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <EditSystemPromptModal
        open={isPromptModalOpen}
        authToken={authToken}
        getAuthToken={getAuthToken}
        project={project}
        templates={templates}
        naming={naming}
        onClose={() => setIsPromptModalOpen(false)}
        onUpdated={(updatedProject) => {
          setIsPromptModalOpen(false);
          onProjectUpdated(updatedProject);
        }}
      />
    </section>
  );
}
