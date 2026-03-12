interface DebugPanelProps {
  selectedModel: string;
  requestId: string;
  responseMs: number | null;
  firstTokenMs: number | null;
  tokensEmitted: number;
  streamStatus: string;
  backendHealthy: boolean;
}

export function DebugPanel({
  selectedModel,
  requestId,
  responseMs,
  firstTokenMs,
  tokensEmitted,
  streamStatus,
  backendHealthy
}: DebugPanelProps) {
  const items = [
    { label: "Backend", value: backendHealthy ? "online" : "offline" },
    { label: "Model", value: selectedModel },
    { label: "Request", value: requestId || "none" },
    { label: "Stream", value: streamStatus },
    { label: "First token", value: firstTokenMs === null ? "n/a" : `${firstTokenMs} ms` },
    { label: "Tokens", value: String(tokensEmitted) },
    { label: "Response", value: responseMs === null ? "n/a" : `${responseMs} ms` }
  ];

  return (
    <section className="nc-diagnostics" aria-label="Diagnostics panel">
      <h2>Diagnostics</h2>
      <div>
        {items.map((item) => (
          <p key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </p>
        ))}
      </div>
    </section>
  );
}
