interface AgentToggleProps {
  active: boolean;
  onChange: (nextValue: boolean) => void;
}

export function AgentToggle({ active, onChange }: AgentToggleProps) {
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-3 rounded-full border px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-950 ${
        active
          ? "border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-400/40 dark:bg-orange-500/10 dark:text-orange-300"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
      }`}
      aria-label="Toggle Agent Mode"
      aria-pressed={active}
      onClick={() => onChange(!active)}
      title={active ? "Agent Mode is ON" : "Agent Mode is OFF"}
    >
      <span
        className={`relative h-6 w-11 rounded-full transition ${
          active ? "bg-orange-500/80" : "bg-slate-300 dark:bg-slate-700"
        }`}
        aria-hidden="true"
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition ${
            active ? "left-[22px]" : "left-0.5"
          }`}
        />
      </span>
      <span>Agent mode</span>
    </button>
  );
}
