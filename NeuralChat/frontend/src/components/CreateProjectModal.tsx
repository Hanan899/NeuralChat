import { useEffect, useRef, useState } from "react";

import type { RequestNamingContext } from "../api";
import { createProject } from "../api/projects";
import { ProjectTemplateIcon } from "./ProjectTemplateIcon";
import type { CreateProjectInput, Project, ProjectTemplate } from "../types/project";

interface CreateProjectModalProps {
  open: boolean;
  authToken: string;
  getAuthToken?: () => Promise<string | null>;
  templates: Record<string, ProjectTemplate>;
  naming?: RequestNamingContext;
  initialTemplate?: string;
  onClose: () => void;
  onCreated: (project: Project) => void;
}

export function CreateProjectModal({
  open,
  authToken,
  getAuthToken,
  templates,
  naming,
  initialTemplate = "startup",
  onClose,
  onCreated,
}: CreateProjectModalProps) {
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState(initialTemplate);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }
    setSelectedTemplate(initialTemplate);
  }, [initialTemplate, open]);

  const activeTemplate = templates[selectedTemplate] ?? templates.custom;

  useEffect(() => {
    if (!open || !activeTemplate) {
      return;
    }
    setProjectDescription((previous) => previous || activeTemplate.description || "");
    window.setTimeout(() => nameInputRef.current?.focus(), 0);
  }, [activeTemplate, open]);

  const previewName = projectName.trim() || "My Project";
  const previewDescription = projectDescription.trim() || activeTemplate?.description || "Describe what this project is for.";
  const canCreate = projectName.trim().length > 0 && !isSubmitting;

  if (!open) {
    return null;
  }

  function buildProjectErrorMessage(error: unknown): string {
    if (!(error instanceof Error)) {
      return "Failed to create project.";
    }

    const normalizedMessage = error.message.trim().toLowerCase();
    if (normalizedMessage.includes("invalid authentication token")) {
      return "Your session is not ready yet. Please wait a moment and try again.";
    }

    if (normalizedMessage.includes("authentication")) {
      return "We couldn't verify your session. Please refresh and try again.";
    }

    return error.message;
  }

  async function handleCreateProject() {
    if (!activeTemplate) {
      return;
    }

    if (!projectName.trim() || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setErrorText("");

    try {
      let resolvedAuthToken = authToken.trim();
      if (!resolvedAuthToken && getAuthToken) {
        for (let attemptNumber = 0; attemptNumber < 3 && !resolvedAuthToken; attemptNumber += 1) {
          resolvedAuthToken = (await getAuthToken())?.trim() || "";
          if (!resolvedAuthToken && attemptNumber < 2) {
            await new Promise((resolve) => window.setTimeout(resolve, 250));
          }
        }
      }

      if (!resolvedAuthToken) {
        setErrorText("We couldn't confirm your session yet. Please wait a second and try again.");
        return;
      }

      const payload: CreateProjectInput = {
        name: projectName.trim(),
        template: selectedTemplate,
        description: projectDescription.trim(),
      };
      const project = await createProject(resolvedAuthToken, payload, naming);
      onCreated(project);
    } catch (error) {
      setErrorText(buildProjectErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="nc-modal" role="dialog" aria-modal="true" aria-label="Create new project">
      <div className="nc-modal__backdrop" onClick={onClose} />
      <section className="nc-modal__panel nc-project-modal">
        <header className="nc-project-modal__header">
          <div>
            <h2>Create New Project</h2>
            <p>Name the workspace, tune the description, and review how NeuralChat will frame this project before you create it.</p>
          </div>
          <button type="button" className="nc-modal__close" onClick={onClose} aria-label="Close modal">
            ×
          </button>
        </header>

        <div className="nc-project-modal__body">
          <div className="nc-project-modal__main">
            <div className="nc-project-modal__template-summary" style={{ ["--template-color" as string]: activeTemplate?.color || "#6366f1" }}>
              <ProjectTemplateIcon template={selectedTemplate} color={activeTemplate?.color} className="nc-project-modal__template-summary-icon" />
              <div className="nc-project-modal__template-summary-copy">
                <strong>{activeTemplate?.label ?? "Selected template"}</strong>
                <span>{activeTemplate?.description ?? "Template-specific workspace"}</span>
              </div>
            </div>

            <div className="nc-project-modal__fields">
              <label className="nc-project-field">
                <span>Name your project</span>
                <input
                  ref={nameInputRef}
                  type="text"
                  value={projectName}
                  maxLength={50}
                  onChange={(event) => setProjectName(event.target.value)}
                  placeholder="My Startup"
                />
              </label>

              <label className="nc-project-field">
                <span>Description (optional)</span>
                <textarea
                  value={projectDescription}
                  onChange={(event) => setProjectDescription(event.target.value)}
                  placeholder={activeTemplate?.description || "Describe what this project is for"}
                  rows={4}
                />
              </label>
            </div>
          </div>

          <aside className="nc-project-modal__sidebar">
            <section className="nc-project-preview" style={{ ["--project-preview-color" as string]: activeTemplate?.color || "#6366f1" }}>
              <div className="nc-project-preview__header">
                <span className="nc-project-preview__eyebrow">Preview</span>
                <span className="nc-project-preview__template-name">{activeTemplate?.label ?? "Template"}</span>
              </div>
              <div className="nc-project-preview__body">
                <ProjectTemplateIcon template={selectedTemplate} color={activeTemplate?.color} className="nc-project-preview__icon" />
                <div className="nc-project-preview__copy">
                  <strong>{previewName}</strong>
                  <span>{previewDescription}</span>
                </div>
              </div>
              <div className="nc-project-preview__hint">
                This workspace will keep related chats, files, and memory together.
              </div>
            </section>
          </aside>
        </div>

        {errorText ? <p className="nc-project-modal__error">{errorText}</p> : null}

        <footer className="nc-project-modal__footer">
          <span className="nc-project-modal__hint">NeuralChat will set up this workspace and open it right away.</span>
          <button type="button" className="nc-button nc-button--primary" disabled={!canCreate} onClick={() => void handleCreateProject()}>
            {isSubmitting ? "Creating…" : "Create Project →"}
          </button>
        </footer>
      </section>
    </div>
  );
}
