import { useEffect, useState } from "react";

import type { RequestNamingContext } from "../api";
import { updateProject } from "../api/projects";
import type { Project, ProjectTemplate } from "../types/project";
import { isProjectAuthTimeoutError, runWithProjectAuthToken } from "../utils/projectAuth";

interface EditSystemPromptModalProps {
  open: boolean;
  authToken: string;
  getAuthToken?: () => Promise<string | null>;
  project: Project;
  templates: Record<string, ProjectTemplate>;
  naming?: RequestNamingContext;
  onClose: () => void;
  onUpdated: (project: Project) => void;
}

export function EditSystemPromptModal({
  open,
  authToken,
  getAuthToken,
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
  const trimmedPromptText = promptText.trim();
  const promptLineCount = trimmedPromptText ? trimmedPromptText.split(/\r?\n/).length : 0;
  const promptCharacterCount = promptText.length;
  const hasUnsavedChanges = promptText !== project.system_prompt;

  function buildPromptEditorErrorMessage(error: unknown): string {
    if (isProjectAuthTimeoutError(error)) {
      return "We couldn't save the prompt right now. Please try again.";
    }
    if (error instanceof Error && error.message.trim().toLowerCase().includes("authentication")) {
      return "We couldn't save the prompt right now. Please try again.";
    }
    return error instanceof Error ? error.message : "Failed to save system prompt.";
  }

  async function handleSavePrompt() {
    setIsSaving(true);
    setErrorText("");
    try {
      const updatedProject = await runWithProjectAuthToken(
        { authToken, getAuthToken },
        async (resolvedAuthToken) => updateProject(resolvedAuthToken, project.project_id, { system_prompt: promptText }, naming),
        { preferFresh: true }
      );
      onUpdated(updatedProject);
    } catch (error) {
      setErrorText(buildPromptEditorErrorMessage(error));
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

        <div className="nc-project-modal__body nc-project-modal__body--editor-only">
          <div className="nc-project-modal__main nc-project-modal__main--editor-only">
            <div className="nc-project-modal__section nc-project-modal__section--editor">
              <div className="nc-project-modal__section-head">
                <div>
                  <h3>Project system prompt</h3>
                  <p>Write clear behavior, boundaries, and response style for this workspace.</p>
                </div>
                <div className="nc-project-modal__stats" aria-label="Prompt stats">
                  <span>{promptLineCount} lines</span>
                  <span>{promptCharacterCount} chars</span>
                  <span>{hasUnsavedChanges ? "Unsaved changes" : "Saved"}</span>
                </div>
              </div>

              <label className="nc-project-field">
                <span className="nc-project-field__label">Prompt text</span>
                <textarea
                  className="nc-project-field__textarea nc-project-field__textarea--prompt"
                  value={promptText}
                  rows={14}
                  onChange={(event) => setPromptText(event.target.value)}
                />
              </label>
            </div>
          </div>
        </div>

        {errorText ? <p className="nc-project-modal__error">{errorText}</p> : null}

        <footer className="nc-project-modal__footer">
          <button type="button" className="nc-button nc-button--ghost" onClick={() => setPromptText(templateDefaultPrompt)}>
            Reset to default
          </button>
          <p className="nc-project-modal__hint">
            Saved changes apply to this project workspace and future replies.
            {templateDefaultPrompt ? " You can reset to the template default any time." : ""}
          </p>
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
