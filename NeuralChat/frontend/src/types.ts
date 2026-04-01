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
  tool:
    | "list_projects"
    | "get_project"
    | "list_project_chats"
    | "get_project_chat"
    | "list_project_files"
    | "read_project_file"
    | "read_memory"
    | "read_usage_summary"
    | "web_search"
    | "read_file"
    | "memory_recall"
    | "create_project"
    | "create_project_chat"
    | "update_memory"
    | "clear_project_memory"
    | null;
  tool_input: string | null;
}

export interface AgentPlan {
  plan_id: string;
  goal: string;
  created_at?: string;
  steps: AgentPlanStep[];
}

export interface AgentPendingConfirmation {
  step_number: number;
  description: string;
  action_type: Exclude<AgentPlanStep["tool"], null>;
  action_label: string;
  action_payload: Record<string, unknown>;
  risk_note?: string | null;
}

export interface AgentStepResult {
  step_number: number;
  description: string;
  tool: AgentPlanStep["tool"];
  tool_input: string | null;
  result: string;
  status: "done" | "failed" | "awaiting_confirmation" | "approved" | "rejected";
  error?: string | null;
}

export interface AgentTaskSummary {
  plan_id: string;
  goal: string;
  created_at: string;
  steps_count: number;
  status?: string;
}

export type UsageFeature =
  | "chat"
  | "memory"
  | "search_decision"
  | "agent_plan"
  | "agent_step"
  | "agent_summary"
  | "title_generation";

export interface UsageRecord {
  timestamp: string;
  feature: UsageFeature | string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface UsageFeatureSummary {
  cost_usd: number;
  calls: number;
  input_tokens: number;
  output_tokens: number;
}

export interface DailyCostPoint {
  date: string;
  cost_usd: number;
}

export interface UsageSummary {
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  by_feature: Record<string, UsageFeatureSummary>;
  daily_costs: DailyCostPoint[];
}

export interface DailyLimitSummary {
  today_cost_usd: number;
  daily_limit_usd: number;
  remaining_usd: number;
  warning_triggered: boolean;
  limit_exceeded: boolean;
  percentage_used: number;
}

export interface TodayUsageResponse {
  records: UsageRecord[];
  summary: DailyLimitSummary;
}

export interface UsageLimitResponse {
  daily_limit_usd: number;
  monthly_limit_usd: number;
}

export interface MonthlyLimitSummary {
  spent_usd: number;
  limit_usd: number;
  remaining_usd: number;
  warning_triggered: boolean;
  limit_exceeded: boolean;
  percentage_used: number;
}

export interface UsageStatusResponse {
  daily: MonthlyLimitSummary;
  monthly: MonthlyLimitSummary;
  blocked: boolean;
  blocking_period: "daily" | "monthly" | null;
  blocking_message: string;
}

export interface AgentTaskState {
  plan: AgentPlan;
  stepResults: AgentStepResult[];
  runningStepNumber: number | null;
  summary: string;
  warning: string;
  status: "preview" | "running" | "awaiting_confirmation" | "completed" | "failed";
  error: string;
  stepsCompleted: number;
  pendingConfirmation: AgentPendingConfirmation | null;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  model: ChatModel;
  projectId?: string;
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
  project_id?: string;
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
