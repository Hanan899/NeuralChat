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
  return (
    <section className="rounded-lg border border-slate-300 bg-white p-3 text-sm">
      <h2 className="mb-2 font-semibold">Debug Panel</h2>
      <p>Backend health: {backendHealthy ? "online" : "offline"}</p>
      <p>Selected model: {selectedModel}</p>
      <p>Last request id: {requestId || "none"}</p>
      <p>Stream status: {streamStatus}</p>
      <p>First token latency: {firstTokenMs === null ? "n/a" : `${firstTokenMs} ms`}</p>
      <p>Tokens emitted: {tokensEmitted}</p>
      <p>Last response time: {responseMs === null ? "n/a" : `${responseMs} ms`}</p>
    </section>
  );
}
