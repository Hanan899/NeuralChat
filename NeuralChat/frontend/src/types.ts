export type ChatModel = "gpt-5";
export type ThemeMode = "system" | "dark" | "light";

export type ChatRole = "user" | "assistant";

export interface SearchSource {
  title: string;
  url: string;
  snippet: string;
}

export interface UploadedFileItem {
  filename: string;
  uploaded_at: string;
  blob_path: string;
}

export interface AgentPlanStep {
  step_number: number;
  description: string;
  tool: "web_search" | "read_file" | "memory_recall" | null;
  tool_input: string | null;
}

export interface AgentPlan {
  plan_id: string;
  goal: string;
  created_at?: string;
  steps: AgentPlanStep[];
}

export interface AgentStepResult {
  step_number: number;
  description: string;
  tool: "web_search" | "read_file" | "memory_recall" | null;
  tool_input: string | null;
  result: string;
  status: "done" | "failed";
  error?: string | null;
}

export interface AgentTaskSummary {
  plan_id: string;
  goal: string;
  created_at: string;
  steps_count: number;
}

export interface AgentTaskState {
  plan: AgentPlan;
  stepResults: AgentStepResult[];
  runningStepNumber: number | null;
  summary: string;
  warning: string;
  status: "preview" | "running" | "completed" | "failed";
  error: string;
  stepsCompleted: number;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  model: ChatModel;
  attachedFiles?: UploadedFileItem[];
  searchUsed?: boolean;
  fileContextUsed?: boolean;
  sources?: SearchSource[];
  agentTask?: AgentTaskState;
}

export interface ChatRequest {
  session_id: string;
  message: string;
  model: ChatModel;
  stream: boolean;
  force_search?: boolean;
}

export interface StreamChunk {
  type: "token" | "done" | "error";
  content: string;
  request_id?: string;
  response_ms?: number;
  first_token_ms?: number;
  tokens_emitted?: number;
  status?: "completed" | "interrupted";
  search_used?: boolean;
  file_context_used?: boolean;
  sources?: SearchSource[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  preview: string;
  updatedAt: string;
  archived?: boolean;
}

export type ConversationGroup = "Today" | "Yesterday" | "Previous 7 Days" | "Older";
