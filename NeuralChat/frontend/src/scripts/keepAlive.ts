import { getApiBaseUrl } from "../api";

const KEEP_ALIVE_INTERVAL_MS = 4 * 60 * 1000;
let hasStartedKeepAlive = false;

function timestampLabel(): string {
  return new Date().toISOString();
}

async function pingKeepWarmEndpoint(): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/api/keep-warm`, {
    method: "GET",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Keep-alive failed with status ${response.status}`);
  }
}

export function startKeepAlive(): void {
  if (hasStartedKeepAlive) {
    return;
  }
  if (import.meta.env.VITE_ENABLE_KEEP_ALIVE !== "true") {
    return;
  }

  hasStartedKeepAlive = true;

  const runPing = async () => {
    try {
      await pingKeepWarmEndpoint();
      console.info(`[keep-alive] success ${timestampLabel()}`);
    } catch (error) {
      console.warn(
        `[keep-alive] failed ${timestampLabel()}`,
        error instanceof Error ? error.message : error
      );
    }
  };

  void runPing();
  window.setInterval(() => {
    void runPing();
  }, KEEP_ALIVE_INTERVAL_MS);
}
