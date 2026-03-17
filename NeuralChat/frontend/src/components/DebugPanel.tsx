interface DebugPanelProps {
  selectedModel: string;
  requestId: string;
  responseMs: number | null;
  firstTokenMs: number | null;
  tokensEmitted: number;
  streamStatus: string;
  backendHealthy: boolean;
  open: boolean;
  onClose: () => void;
}

export function DebugPanel({
  selectedModel,
  requestId,
  responseMs,
  firstTokenMs,
  tokensEmitted,
  streamStatus,
  backendHealthy,
  open,
  onClose,
}: DebugPanelProps) {
  if (!open) {
    return null;
  }

  const rows = [
    { label: "backend", value: backendHealthy ? "online" : "offline" },
    { label: "model", value: selectedModel },
    { label: "request_id", value: requestId || "none" },
    { label: "response_ms", value: responseMs === null ? "n/a" : `${responseMs}ms` },
    { label: "first_token_ms", value: firstTokenMs === null ? "n/a" : `${firstTokenMs}ms` },
    { label: "tokens_emitted", value: String(tokensEmitted) },
    { label: "status", value: streamStatus },
  ];

  return (
    <section
      className="fixed bottom-24 left-4 z-40 w-[min(320px,calc(100vw-2rem))] rounded-2xl border border-slate-700/80 bg-slate-950/90 p-4 text-slate-100 shadow-2xl backdrop-blur md:bottom-6"
      aria-label="Diagnostics panel"
      data-testid="debug-panel"
    >
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Debug</p>
          <h2 className="text-sm font-semibold text-white">Runtime metrics</h2>
        </div>
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-700 text-slate-300 transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-950"
          aria-label="Close debug panel"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="grid gap-2 font-mono text-[12px] leading-6">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-slate-800/80 pb-2 last:border-b-0 last:pb-0">
            <span className="text-slate-400">{row.label}</span>
            <strong className="text-right font-semibold text-slate-100">{row.value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
