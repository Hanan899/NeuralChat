export type ProjectTemplate = {
  emoji: string;
  color: string;
  label: string;
  description: string;
  system_prompt: string;
  memory_keys: string[];
};

export type Project = {
  project_id: string;
  user_id?: string;
  name: string;
  description: string;
  emoji: string;
  template: string;
  color: string;
  system_prompt: string;
  created_at: string;
  updated_at: string;
  chat_count: number;
  pinned: boolean;
};

export type ProjectChat = {
  session_id: string;
  created_at: string;
  message_count: number;
  last_message_preview: string;
};

export type CreateProjectInput = {
  name: string;
  template: string;
  description?: string;
  emoji?: string;
  color?: string;
  custom_system_prompt?: string;
};

export type ProjectMemoryCompleteness = {
  percentage: number;
  filled_keys: string[];
  missing_keys: string[];
  suggestion: string;
};

export type ProjectBrainLogEntry = {
  timestamp: string;
  session_id: string;
  extracted_facts: Record<string, string>;
  tokens_used: number;
};

export type ProjectMemoryResponse = {
  memory: Record<string, string>;
  completeness: ProjectMemoryCompleteness;
};
