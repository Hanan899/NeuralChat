export type ChatModel = "gpt-5";

export type ChatRole = "user" | "assistant";

export interface SearchSource {
  title: string;
  url: string;
  snippet: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  model: ChatModel;
  searchUsed?: boolean;
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
  sources?: SearchSource[];
}
