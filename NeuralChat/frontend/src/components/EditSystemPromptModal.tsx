import { useEffect, useState } from "react";

import type { RequestNamingContext } from "../api";
import { updateProject } from "../api/projects";
import type { Project, ProjectTemplate } from "../types/project";

interface EditSystemPromptModalProps {
  open: boolean;
  authToken: string;
  project: Project;
  templates: Record<string, ProjectTemplate>;
  naming?: RequestNamingContext;
  onClose: () => void;
  onUpdated: (project: Project) => void;
}

export function EditSystemPromptModal({
  open,
  authToken,
  project,
  templates,
  naming,
  onClose,
  onUpdated,
}: EditSystemPromptModalProps) {
  const [promptText, setPromptText] = useState(project.system_prompt);
  const [isSaving, setIsSaving] = useState(false);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    setPromptText(project.system_prompt);
    setErrorText("");
  }, [project.system_prompt, project.project_id]);

  if (!open) {
    return null;
  }

  const templateDefaultPrompt = templates[project.template]?.system_prompt || "";

  async function handleSavePrompt() {
    setIsSaving(true);
    setErrorText("");
    try {
      const updatedProject = await updateProject(authToken, project.project_id, { system_prompt: promptText }, naming);
      onUpdated(updatedProject);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to save system prompt.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="nc-modal" role="dialog" aria-modal="true" aria-label="Edit project system prompt">
      <div className="nc-modal__backdrop" onClick={onClose} />
      <section className="nc-modal__panel nc-project-modal">
        <header className="nc-project-modal__header">
          <div>
            <h2>Edit system prompt</h2>
            <p>Customize how NeuralChat behaves inside this project workspace.</p>
          </div>
          <button type="button" className="nc-modal__close" onClick={onClose} aria-label="Close system prompt modal">
            ×
          </button>
        </header>

        <label className="nc-project-field">
          <span>Project system prompt</span>
          <textarea value={promptText} rows={12} onChange={(event) => setPromptText(event.target.value)} />
        </label>

        {errorText ? <p className="nc-project-modal__error">{errorText}</p> : null}

        <footer className="nc-project-modal__footer">
          <button type="button" className="nc-button nc-button--ghost" onClick={() => setPromptText(templateDefaultPrompt)}>
            Reset to default
          </button>
          <div className="nc-project-modal__footer-actions">
            <button type="button" className="nc-button nc-button--ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="nc-button nc-button--primary" disabled={isSaving} onClick={() => void handleSavePrompt()}>
              {isSaving ? "Saving…" : "Save prompt"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
