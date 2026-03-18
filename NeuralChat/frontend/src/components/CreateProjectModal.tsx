import { useEffect, useMemo, useRef, useState } from "react";

import type { RequestNamingContext } from "../api";
import { createProject } from "../api/projects";
import { ProjectTemplateIcon } from "./ProjectTemplateIcon";
import type { CreateProjectInput, Project, ProjectTemplate } from "../types/project";

interface CreateProjectModalProps {
  open: boolean;
  authToken: string;
  templates: Record<string, ProjectTemplate>;
  naming?: RequestNamingContext;
  initialTemplate?: string;
  onClose: () => void;
  onCreated: (project: Project) => void;
}

const TEMPLATE_ORDER = ["startup", "study", "code", "writing", "research", "job", "custom"];
const COLOR_SWATCHES = ["#6366f1", "#10b981", "#3b82f6", "#f59e0b", "#8b5cf6", "#ec4899", "#6b7280"];

export function CreateProjectModal({
  open,
  authToken,
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
  const [projectEmoji, setProjectEmoji] = useState("");
  const [projectColor, setProjectColor] = useState("");
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
    setProjectEmoji((previous) => previous || activeTemplate.emoji || "");
    setProjectColor((previous) => previous || activeTemplate.color || "");
    window.setTimeout(() => nameInputRef.current?.focus(), 0);
  }, [activeTemplate, open]);

  const previewName = projectName.trim() || "My Project";
  const previewDescription = projectDescription.trim() || activeTemplate?.description || "Describe what this project is for.";
  const canCreate = projectName.trim().length > 0 && !isSubmitting;

  const orderedTemplates = useMemo(
    () => TEMPLATE_ORDER.filter((templateKey) => Boolean(templates[templateKey])).map((templateKey) => ({ key: templateKey, ...templates[templateKey] })),
    [templates]
  );

  if (!open) {
    return null;
  }

  async function handleCreateProject() {
    if (!canCreate || !activeTemplate) {
      return;
    }

    setIsSubmitting(true);
    setErrorText("");

    try {
      const payload: CreateProjectInput = {
        name: projectName.trim(),
        template: selectedTemplate,
        description: projectDescription.trim(),
        emoji: projectEmoji.trim(),
        color: projectColor.trim(),
      };
      const project = await createProject(authToken, payload, naming);
      onCreated(project);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to create project.");
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
            <p>Give NeuralChat a dedicated workspace for one focused area of work.</p>
          </div>
          <button type="button" className="nc-modal__close" onClick={onClose} aria-label="Close modal">
            ×
          </button>
        </header>

        <div className="nc-project-modal__section">
          <h3>1. Pick a template</h3>
          <div className="nc-template-pill-grid">
            {orderedTemplates.map((template) => {
              const isActive = template.key === selectedTemplate;
              return (
                <button
                  key={template.key}
                  type="button"
                  className={`nc-template-pill ${isActive ? "nc-template-pill--active" : ""}`}
                  style={{ ["--template-color" as string]: template.color }}
                  onClick={() => {
                    setSelectedTemplate(template.key);
                    setProjectDescription(template.description || "");
                    setProjectEmoji(template.emoji || "");
                    setProjectColor(template.color || "");
                  }}
                >
                  <ProjectTemplateIcon template={template.key} color={template.color} className="nc-template-pill__icon" />
                  <span className="nc-template-pill__label">{template.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="nc-project-modal__fields">
          <label className="nc-project-field">
            <span>2. Name your project</span>
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
            <span>3. Describe it (optional)</span>
            <textarea
              value={projectDescription}
              onChange={(event) => setProjectDescription(event.target.value)}
              placeholder={activeTemplate?.description || "Describe what this project is for"}
              rows={3}
            />
          </label>

          <div className="nc-project-modal__customize">
            <label className="nc-project-field nc-project-field--emoji">
              <span>Accent mark</span>
              <input type="text" value={projectEmoji} maxLength={2} onChange={(event) => setProjectEmoji(event.target.value)} />
            </label>

            <div className="nc-project-field nc-project-field--swatches">
              <span>Color</span>
              <div className="nc-project-color-swatches">
                {COLOR_SWATCHES.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    className={`nc-project-color-swatch ${projectColor === swatch ? "nc-project-color-swatch--active" : ""}`}
                    style={{ background: swatch }}
                    aria-label={`Choose ${swatch} as project color`}
                    onClick={() => setProjectColor(swatch)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        <section className="nc-project-preview" style={{ ["--project-preview-color" as string]: projectColor || activeTemplate?.color || "#6366f1" }}>
          <ProjectTemplateIcon template={selectedTemplate} color={projectColor || activeTemplate?.color} className="nc-project-preview__icon" />
          <div className="nc-project-preview__copy">
            <strong>{previewName}</strong>
            <span>{previewDescription}</span>
          </div>
          <div className="nc-project-preview__aside">
            {projectEmoji.trim() ? <span className="nc-project-preview__mark">{projectEmoji.trim()}</span> : null}
            <span className="nc-project-preview__badge">Preview</span>
          </div>
        </section>

        <section className="nc-project-memory-keys">
          <h3>AI will remember</h3>
          {activeTemplate?.memory_keys?.length ? (
            <div className="nc-project-memory-keys__list">
              {activeTemplate.memory_keys.map((memoryKey) => (
                <span key={memoryKey} className="nc-project-memory-keys__item">
                  {memoryKey}
                </span>
              ))}
            </div>
          ) : (
            <p>This template starts blank so the AI can learn your own custom structure.</p>
          )}
        </section>

        {errorText ? <p className="nc-project-modal__error">{errorText}</p> : null}

        <footer className="nc-project-modal__footer">
          <button type="button" className="nc-button nc-button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="nc-button nc-button--primary" disabled={!canCreate} onClick={() => void handleCreateProject()}>
            {isSubmitting ? "Creating…" : "Create Project →"}
          </button>
        </footer>
      </section>
    </div>
  );
}
