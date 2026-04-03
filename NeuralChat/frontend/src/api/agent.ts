import { getApiBaseUrl, readErrorMessage } from "../api";
import type { RequestNamingContext } from "../api";
import type {
  AgentContextMessage,
  AgentPendingConfirmation,
  AgentPlan,
  AgentStepResult,
  AgentTaskSummary,
} from "../types";

export interface AgentRunCallbacks {
  onPlan?: (plan: AgentPlan) => void;
  onStepStart?: (payload: { step_number: number; description: string }) => void;
  onStepDone?: (payload: AgentStepResult) => void;
  onConfirmationRequired?: (payload: AgentPendingConfirmation) => void;
  onWarning?: (message: string) => void;
  onSummaryToken?: (token: string) => void;
  onDone?: (payload: { plan_id: string; steps_completed: number; warning?: string }) => void;
  onError?: (message: string) => void;
}

export interface AgentConfirmationRequest {
  session_id: string;
  step_number: number;
  approved: boolean;
}

export interface AgentPlanRequestContext {
  recent_context?: AgentContextMessage[];
  session_mode?: "chat" | "project_chat";
  project_id?: string;
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
  pending_confirmation?: AgentPendingConfirmation | null;
}

export async function createAgentPlan(
  authToken: string,
  goal: string,
  sessionId: string,
  context?: AgentPlanRequestContext,
  naming?: RequestNamingContext
): Promise<AgentPlan> {
  return createAgentPlanWithNaming(authToken, goal, sessionId, context, naming);
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
  context?: AgentPlanRequestContext,
  naming?: RequestNamingContext
): Promise<AgentPlan> {
  const response = await fetch(`${getApiBaseUrl()}/api/agent/plan`, {
    method: "POST",
    headers: buildAgentHeaders(authToken, naming),
    body: JSON.stringify({
      goal,
      session_id: sessionId,
      recent_context: context?.recent_context ?? [],
      session_mode: context?.session_mode,
      project_id: context?.project_id,
    }),
  });

  if (!response.ok) {
    const errorText = await readErrorMessage(response, "Failed to create agent plan.");
    throw new Error(errorText);
  }

  const payload = (await response.json()) as AgentPlanResponse;
  return payload.plan;
}

async function streamAgentExecution(
  endpoint: string,
  authToken: string,
  body: Record<string, unknown>,
  callbacks: AgentRunCallbacks,
  signal?: AbortSignal,
  naming?: RequestNamingContext
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: buildAgentHeaders(authToken, naming),
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Generation stopped by user.");
    }
    throw error;
  }

  if (!response.ok) {
    const errorText = await readErrorMessage(response, "Agent run failed.");
    throw new Error(errorText);
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
            description: String(chunk.description || ""),
            tool: (chunk.tool as AgentStepResult["tool"]) ?? null,
            tool_input: typeof chunk.tool_input === "string" ? chunk.tool_input : null,
            result: String(chunk.result || ""),
            status: (chunk.status as AgentStepResult["status"]) ?? "done",
            error: typeof chunk.error === "string" ? chunk.error : null,
          });
          continue;
        }
        if (chunkType === "confirmation_required") {
          callbacks.onConfirmationRequired?.({
            step_number: Number(chunk.step_number),
            description: String(chunk.description || ""),
            action_type: chunk.action_type as AgentPendingConfirmation["action_type"],
            action_label: String(chunk.action_label || "Workspace action"),
            action_payload: (chunk.action_payload as Record<string, unknown>) ?? {},
            risk_note: typeof chunk.risk_note === "string" ? chunk.risk_note : null,
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
            plan_id: String(chunk.plan_id || ""),
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
        plan_id: String(chunk.plan_id || ""),
        steps_completed: Number(chunk.steps_completed || 0),
        warning: typeof chunk.warning === "string" ? chunk.warning : undefined,
      });
    }
  }
}

export async function runAgent(
  authToken: string,
  planId: string,
  sessionId: string,
  callbacks: AgentRunCallbacks,
  signal?: AbortSignal,
  naming?: RequestNamingContext
): Promise<void> {
  await streamAgentExecution(
    `${getApiBaseUrl()}/api/agent/run/${encodeURIComponent(planId)}`,
    authToken,
    { session_id: sessionId },
    callbacks,
    signal,
    naming
  );
}

export async function confirmAgentAction(
  authToken: string,
  planId: string,
  request: AgentConfirmationRequest,
  callbacks: AgentRunCallbacks,
  signal?: AbortSignal,
  naming?: RequestNamingContext
): Promise<void> {
  await streamAgentExecution(
    `${getApiBaseUrl()}/api/agent/confirm/${encodeURIComponent(planId)}`,
    authToken,
    request,
    callbacks,
    signal,
    naming
  );
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
