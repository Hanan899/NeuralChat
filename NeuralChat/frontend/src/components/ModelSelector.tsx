import type { ChatModel } from "../types";

interface ModelSelectorProps {
  value: ChatModel;
  onChange: (model: ChatModel) => void;
}

export function ModelSelector({ value, onChange }: ModelSelectorProps) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium text-brand-dark">
      Model
      <select
        className="rounded-md border border-slate-300 px-2 py-1"
        value={value}
        onChange={(event) => onChange(event.target.value as ChatModel)}
      >
        <option value="gpt-5">GPT-5 (Azure OpenAI)</option>
      </select>
    </label>
  );
}
