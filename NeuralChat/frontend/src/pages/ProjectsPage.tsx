import { useMemo, useState } from "react";

import type { RequestNamingContext } from "../api";
import { CreateProjectModal } from "../components/CreateProjectModal";
import { ProjectTemplateIcon } from "../components/ProjectTemplateIcon";
import type { Project, ProjectTemplate } from "../types/project";

interface ProjectsPageProps {
  authToken: string;
  naming?: RequestNamingContext;
  projects: Project[];
  templates: Record<string, ProjectTemplate>;
  isLoading: boolean;
  errorText: string;
  onRefresh: () => Promise<void> | void;
  onOpenProject: (projectId: string) => void;
}

const TEMPLATE_ORDER = ["startup", "study", "code", "writing", "research", "job", "custom"];

function formatChatCount(chatCount: number): string {
  return `${chatCount} chat${chatCount === 1 ? "" : "s"}`;
}

function formatUpdatedAt(updatedAt: string): string {
  if (!updatedAt) {
    return "Updated recently";
  }
  const dateValue = new Date(updatedAt);
  const today = new Date();
  if (dateValue.toDateString() === today.toDateString()) {
    return "Updated today";
  }
  return `Updated ${dateValue.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

export function ProjectsPage({
  authToken,
  naming,
  projects,
  templates,
  isLoading,
  errorText,
  onRefresh,
  onOpenProject,
}: ProjectsPageProps) {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [initialTemplate, setInitialTemplate] = useState("startup");

  const orderedTemplates = useMemo(
    () => TEMPLATE_ORDER.filter((templateKey) => Boolean(templates[templateKey])).map((templateKey) => ({ key: templateKey, ...templates[templateKey] })),
    [templates]
  );

  function handleOpenCreateModal(templateKey = "startup") {
    setInitialTemplate(templateKey);
    setIsCreateModalOpen(true);
  }

  return (
    <section className="nc-projects-page" data-testid="projects-page">
      <header className="nc-projects-page__header">
        <div>
          <p className="nc-projects-page__eyebrow">Workspace</p>
          <h2>Projects</h2>
          <p>Give your AI a dedicated workspace for each area of your life and work.</p>
        </div>
        {projects.length > 0 ? (
          <button type="button" className="nc-button nc-button--primary" onClick={() => handleOpenCreateModal("startup")}>
            + New Project
          </button>
        ) : null}
      </header>

      {errorText ? <p className="nc-projects-page__error">{errorText}</p> : null}

      {isLoading ? (
        <div className="nc-projects-grid">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="nc-project-card nc-project-card--skeleton" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="nc-projects-empty">
          <div className="nc-projects-empty__hero">
            <ProjectTemplateIcon template="custom" className="nc-projects-empty__icon" />
            <div>
              <h3>Welcome to Projects</h3>
              <p>Choose a template to create your first dedicated workspace.</p>
            </div>
          </div>
          <div className="nc-projects-grid nc-projects-grid--templates">
            {orderedTemplates.map((template) => (
              <button
                key={template.key}
                type="button"
                className="nc-project-card nc-project-card--template"
                style={{ ["--project-color" as string]: template.color }}
                onClick={() => handleOpenCreateModal(template.key)}
              >
                <div className="nc-project-card__top">
                  <ProjectTemplateIcon template={template.key} color={template.color} className="nc-project-card__icon" />
                  <span className="nc-project-card__badge">Template</span>
                </div>
                <strong>{template.label}</strong>
                <span>{template.description}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="nc-projects-grid">
          {projects.map((project) => (
            <button
              key={project.project_id}
              type="button"
              className="nc-project-card"
              style={{ ["--project-color" as string]: project.color }}
              onClick={() => onOpenProject(project.project_id)}
            >
              <div className="nc-project-card__top">
                <ProjectTemplateIcon template={project.template} color={project.color} className="nc-project-card__icon" />
                {project.pinned ? <span className="nc-project-card__pin">Pinned</span> : null}
              </div>
              <div className="nc-project-card__meta">
                <strong>{project.name}</strong>
                <span className="nc-project-card__description">{project.description || templates[project.template]?.description || "Dedicated project workspace"}</span>
                <div className="nc-project-card__stats">
                  <span>{formatChatCount(project.chat_count)}</span>
                  <span>{formatUpdatedAt(project.updated_at)}</span>
                </div>
              </div>
            </button>
          ))}

          <button type="button" className="nc-project-card nc-project-card--new" onClick={() => handleOpenCreateModal("startup")}>
            <span className="nc-project-card__add-icon" aria-hidden="true">
              ＋
            </span>
            <strong>New Project</strong>
            <span>Create another dedicated workspace</span>
          </button>
        </div>
      )}

      <CreateProjectModal
        open={isCreateModalOpen}
        authToken={authToken}
        templates={templates}
        naming={naming}
        initialTemplate={initialTemplate}
        onClose={() => setIsCreateModalOpen(false)}
        onCreated={(project) => {
          setIsCreateModalOpen(false);
          void onRefresh();
          onOpenProject(project.project_id);
        }}
      />
    </section>
  );
}
