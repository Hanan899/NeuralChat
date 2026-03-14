import { getApiBaseUrl } from "../api";
import type { RequestNamingContext } from "../api";
import type { AgentPlan, AgentStepResult, AgentTaskSummary } from "../types";

export interface AgentRunCallbacks {
  onPlan?: (plan: AgentPlan) => void;
  onStepStart?: (payload: { step_number: number; description: string }) => void;
  onStepDone?: (payload: AgentStepResult) => void;
  onWarning?: (message: string) => void;
  onSummaryToken?: (token: string) => void;
  onDone?: (payload: { plan_id: string; steps_completed: number; warning?: string }) => void;
  onError?: (message: string) => void;
}

interface AgentPlanResponse {
  plan: AgentPlan;
}

interface AgentHistoryResponse {
  tasks: AgentTaskSummary[];
}

interface AgentTaskDetailResponse {
  plan: AgentPlan;
  log: AgentStepResult[];
}

export async function createAgentPlan(
  authToken: string,
  goal: string,
  sessionId: string,
  naming?: RequestNamingContext
): Promise<AgentPlan> {
  return createAgentPlanWithNaming(authToken, goal, sessionId, naming);
}

function buildAgentHeaders(authToken: string, naming?: RequestNamingContext): HeadersInit {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
  };
  if (naming?.userDisplayName?.trim()) {
    headers["X-User-Display-Name"] = naming.userDisplayName.trim();
  }
  if (naming?.sessionTitle?.trim()) {
    headers["X-Session-Title"] = naming.sessionTitle.trim();
  }
  return headers;
}

export async function createAgentPlanWithNaming(
  authToken: string,
  goal: string,
  sessionId: string,
  naming?: RequestNamingContext
): Promise<AgentPlan> {
  const response = await fetch(`${getApiBaseUrl()}/api/agent/plan`, {
    method: "POST",
    headers: buildAgentHeaders(authToken, naming),
    body: JSON.stringify({ goal, session_id: sessionId }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Failed to create agent plan.");
  }

  const payload = (await response.json()) as AgentPlanResponse;
  return payload.plan;
}

export async function runAgent(
  authToken: string,
  planId: string,
  sessionId: string,
  callbacks: AgentRunCallbacks,
  signal?: AbortSignal,
  naming?: RequestNamingContext
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}/api/agent/run/${encodeURIComponent(planId)}`, {
      method: "POST",
      headers: buildAgentHeaders(authToken, naming),
      body: JSON.stringify({ session_id: sessionId }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Generation stopped by user.");
    }
    throw error;
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Agent run failed.");
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Streaming is not supported in this browser.");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        const chunk = JSON.parse(line) as Record<string, unknown>;
        const chunkType = String(chunk.type || "");

        if (chunkType === "plan") {
          callbacks.onPlan?.(chunk.plan as AgentPlan);
          continue;
        }
        if (chunkType === "step_start") {
          callbacks.onStepStart?.({
            step_number: Number(chunk.step_number),
            description: String(chunk.description || ""),
          });
          continue;
        }
        if (chunkType === "step_done") {
          callbacks.onStepDone?.({
            step_number: Number(chunk.step_number),
            description: "",
            tool: null,
            tool_input: null,
            result: String(chunk.result || ""),
            status: chunk.status === "failed" ? "failed" : "done",
            error: typeof chunk.error === "string" ? chunk.error : null,
          });
          continue;
        }
        if (chunkType === "warning") {
          callbacks.onWarning?.(String(chunk.message || ""));
          continue;
        }
        if (chunkType === "summary") {
          callbacks.onSummaryToken?.(String(chunk.content || ""));
          continue;
        }
        if (chunkType === "done") {
          callbacks.onDone?.({
            plan_id: String(chunk.plan_id || planId),
            steps_completed: Number(chunk.steps_completed || 0),
            warning: typeof chunk.warning === "string" ? chunk.warning : undefined,
          });
          continue;
        }
        if (chunkType === "error") {
          callbacks.onError?.(String(chunk.message || "Agent run failed."));
        }
      }
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Generation stopped by user.");
    }
    throw error;
  }

  if (buffer.trim()) {
    const chunk = JSON.parse(buffer) as Record<string, unknown>;
    if (chunk.type === "done") {
      callbacks.onDone?.({
        plan_id: String(chunk.plan_id || planId),
        steps_completed: Number(chunk.steps_completed || 0),
        warning: typeof chunk.warning === "string" ? chunk.warning : undefined,
      });
    }
  }
}

export async function getAgentHistory(authToken: string, naming?: RequestNamingContext): Promise<AgentTaskSummary[]> {
  const response = await fetch(`${getApiBaseUrl()}/api/agent/history`, {
    headers: buildAgentHeaders(authToken, naming),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Failed to load agent history.");
  }

  const payload = (await response.json()) as AgentHistoryResponse;
  return payload.tasks;
}

export async function getAgentTask(authToken: string, planId: string, naming?: RequestNamingContext): Promise<AgentTaskDetailResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/agent/history/${encodeURIComponent(planId)}`, {
    headers: buildAgentHeaders(authToken, naming),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Failed to load agent task.");
  }

  return (await response.json()) as AgentTaskDetailResponse;
}