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
