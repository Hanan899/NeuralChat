import { buildProtectedHeaders, getApiBaseUrl, readErrorMessage, type RequestNamingContext } from "../api";
import type { ChatMessage } from "../types";
import type { CreateProjectInput, Project, ProjectChat, ProjectTemplate } from "../types/project";

const API_BASE_URL = getApiBaseUrl();

export async function getTemplates(): Promise<Record<string, ProjectTemplate>> {
  const response = await fetch(`${API_BASE_URL}/api/projects/templates`);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Failed to load project templates.");
  }
  return (await response.json()) as Record<string, ProjectTemplate>;
}

export async function getAllProjects(authToken: string, naming?: RequestNamingContext): Promise<Project[]> {
  const response = await fetch(`${API_BASE_URL}/api/projects`, {
    headers: buildProtectedHeaders(authToken, naming),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to load projects."));
  }
  const payload = (await response.json()) as { projects?: Project[] };
  return Array.isArray(payload.projects) ? payload.projects : [];
}

export async function createProject(authToken: string, data: CreateProjectInput, naming?: RequestNamingContext): Promise<Project> {
  const response = await fetch(`${API_BASE_URL}/api/projects`, {
    method: "POST",
    headers: buildProtectedHeaders(authToken, naming, true),
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to create project."));
  }
  return (await response.json()) as Project;
}

export async function getProject(authToken: string, projectId: string, naming?: RequestNamingContext): Promise<Project> {
  const response = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}`, {
    headers: buildProtectedHeaders(authToken, naming),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to load project."));
  }
  return (await response.json()) as Project;
}

export async function updateProject(
  authToken: string,
  projectId: string,
  updates: Partial<Project>,
  naming?: RequestNamingContext
): Promise<Project> {
  const response = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    headers: buildProtectedHeaders(authToken, naming, true),
    body: JSON.stringify(updates),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to update project."));
  }
  return (await response.json()) as Project;
}

export async function deleteProject(authToken: string, projectId: string, naming?: RequestNamingContext): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
    headers: buildProtectedHeaders(authToken, naming),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to delete project."));
  }
}

export async function getProjectChats(authToken: string, projectId: string, naming?: RequestNamingContext): Promise<ProjectChat[]> {
  const response = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/chats`, {
    headers: buildProtectedHeaders(authToken, naming),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to load project chats."));
  }
  const payload = (await response.json()) as { chats?: ProjectChat[] };
  return Array.isArray(payload.chats) ? payload.chats : [];
}

export async function getProjectChatMessages(
  authToken: string,
  projectId: string,
  sessionId: string,
  naming?: RequestNamingContext
): Promise<ChatMessage[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/chats/${encodeURIComponent(sessionId)}`,
    { headers: buildProtectedHeaders(authToken, naming) }
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to load project chat."));
  }
  const payload = (await response.json()) as { messages?: ChatMessage[] };
  return Array.isArray(payload.messages) ? payload.messages : [];
}

export async function createProjectChat(
  authToken: string,
  projectId: string,
  naming?: RequestNamingContext
): Promise<{ session_id: string }> {
  const response = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/chats`, {
    method: "POST",
    headers: buildProtectedHeaders(authToken, naming),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to create project chat."));
  }
  return (await response.json()) as { session_id: string };
}

export async function deleteProjectChat(
  authToken: string,
  projectId: string,
  sessionId: string,
  naming?: RequestNamingContext
): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/chats/${encodeURIComponent(sessionId)}`,
    {
      method: "DELETE",
      headers: buildProtectedHeaders(authToken, naming),
    }
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to delete project chat."));
  }
}

export async function getProjectMemory(
  authToken: string,
  projectId: string,
  naming?: RequestNamingContext
): Promise<Record<string, unknown>> {
  const response = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/memory`, {
    headers: buildProtectedHeaders(authToken, naming),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to load project memory."));
  }
  const payload = (await response.json()) as { memory?: Record<string, unknown> };
  return payload.memory && typeof payload.memory === "object" ? payload.memory : {};
}
