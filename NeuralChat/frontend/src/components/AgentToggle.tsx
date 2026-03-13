interface AgentToggleProps {
  active: boolean;
  onChange: (nextValue: boolean) => void;
}

export function AgentToggle({ active, onChange }: AgentToggleProps) {
  return (
    <button
      type="button"
      className={`nc-agent-toggle ${active ? "nc-agent-toggle--active" : ""}`}
      aria-label="Toggle Agent Mode"
      aria-pressed={active}
      onClick={() => onChange(!active)}
      title={active ? "Agent Mode is ON" : "Agent Mode is OFF"}
    >
      <span className="nc-agent-toggle__track" aria-hidden="true">
        <span className="nc-agent-toggle__thumb" />
      </span>
      <span className="nc-agent-toggle__label">Agent Mode</span>
    </button>
  );
}
