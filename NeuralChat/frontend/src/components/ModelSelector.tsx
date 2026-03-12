import type { ChatModel } from "../types";

interface ModelSelectorProps {
  value: ChatModel;
  onChange: (model: ChatModel) => void;
  variant?: "topbar" | "composer";
}

export function ModelSelector({ value, onChange, variant = "composer" }: ModelSelectorProps) {
  const className = variant === "topbar" ? "nc-model-pill nc-model-pill--top" : "nc-model-pill";

  return (
    <label className={className}>
      <select value={value} onChange={(event) => onChange(event.target.value as ChatModel)} aria-label="Model selector">
        <option value="gpt-5">GPT-5</option>
      </select>
      <span className="nc-model-chevron" aria-hidden="true">
        ▾
      </span>
    </label>
  );
}
