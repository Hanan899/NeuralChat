export type ChatModel = string;
export type ThemeMode = "system" | "dark" | "light";

export type ChatRole = "user" | "assistant";

export interface SearchSource {
  title: string;
  url: string;
  snippet: string;
  document_id?: string;
  chunk_id?: string;
  collection_id?: string;
  score?: number;
}

export interface UploadedFileItem {
  filename: string;
  uploaded_at: string;
  blob_path: string;
}

export type AgentMode = "research" | "coding" | "workspace_read" | "workspace_write" | "clarify";

export interface AgentContextMessage {
  role: ChatRole;
  content?: string;
  summary?: string;
  source?: "session" | "agent";
}

export interface AgentPlanStep {
  step_number: number;
  description: string;
  tool:
    | "clarify"
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
    | "inspect_repo"
    | "read_code_file"
    | "search_codebase"
    | "run_command"
    | "run_tests"
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
  mode?: AgentMode;
  classification_reason?: string;
  clarification_question?: string;
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
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  contextWindowTokens?: number;
  contextPercentageUsed?: number;
  searchUsed?: boolean;
  fileContextUsed?: boolean;
  sources?: SearchSource[];
  resolvedProvider?: string;
  resolvedModel?: string;
  resolvedAgentId?: string;
  routeKind?: "general" | "documents" | "dynamic_agent";
  routeConfidence?: number | null;
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
  type: "route" | "token" | "done" | "error" | "sources";
  content: string;
  request_id?: string;
  response_ms?: number;
  first_token_ms?: number;
  tokens_emitted?: number;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  context_window_tokens?: number;
  context_percentage_used?: number;
  status?: "completed" | "interrupted";
  search_used?: boolean;
  file_context_used?: boolean;
  sources?: SearchSource[];
  resolved_provider?: string;
  resolved_model?: string;
  resolved_agent_id?: string;
  route_kind?: "general" | "documents" | "dynamic_agent";
  route_confidence?: number | null;
}

export interface ConversationSummary {
  id: string;
  title: string;
  preview: string;
  updatedAt: string;
  archived?: boolean;
  workspaceKind?: "standard" | "agent" | "research";
}

export type ConversationGroup = "Today" | "Yesterday" | "Previous 7 Days" | "Older";

export interface PlatformProvider {
  id: string;
  provider_key: string;
  display_name: string;
  description?: string | null;
  enabled: boolean;
  is_default_chat: boolean;
  is_default_embeddings: boolean;
  base_url?: string | null;
  api_version?: string | null;
  default_chat_model?: string | null;
  default_embedding_model?: string | null;
  allowed_models: string[];
  metadata: Record<string, unknown>;
}

export interface PlatformTool {
  id: string;
  tool_slug: string;
  name: string;
  description?: string | null;
  kind: "http" | "mcp" | string;
  approval_status: string;
  enabled: boolean;
  method?: string | null;
  url?: string | null;
  timeout_seconds: number;
  retry_limit: number;
  input_schema: Record<string, unknown>;
  response_config: Record<string, unknown>;
}

export interface PlatformMcpEndpoint {
  id: string;
  name: string;
  endpoint_url: string;
  enabled: boolean;
  last_synced_at?: string | null;
  last_sync_error?: string | null;
  metadata: Record<string, unknown>;
}

export interface PlatformCollection {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  allowed_agent_ids: string[];
  metadata: Record<string, unknown>;
}

export interface PlatformDocument {
  id: string;
  collection_id: string;
  filename: string;
  blob_path: string;
  status: string;
  content_type?: string | null;
  size_bytes: number;
  chunk_count: number;
  indexed_at?: string | null;
  error_message?: string | null;
}

export interface PlatformAgentVersion {
  id: string;
  status: string;
  version_number: number;
  model_id?: string | null;
  system_prompt: string;
  tool_ids: string[];
  collection_ids: string[];
  config: Record<string, unknown>;
  submitted_by_user_id?: string | null;
  approved_by_user_id?: string | null;
  approved_at?: string | null;
}

export interface PlatformAgent {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  status: string;
  owner_user_id: string;
  latest_version_id?: string | null;
  published_version_id?: string | null;
  version?: PlatformAgentVersion | null;
}

export interface PlatformRoutePreview {
  target_kind: "general" | "documents" | "dynamic_agent";
  target_id?: string | null;
  confidence: number;
  reason: string;
}
