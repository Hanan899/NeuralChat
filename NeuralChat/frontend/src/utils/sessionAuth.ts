const SESSION_AUTH_TIMEOUT_MESSAGE = "SESSION_AUTH_TIMEOUT";

type SessionAuthConfig = {
  authToken?: string | null;
  getAuthToken?: () => Promise<string | null>;
};

type ResolveSessionAuthOptions = {
  timeoutMs?: number;
  retryDelayMs?: number;
  preferFresh?: boolean;
};

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

export function isInvalidAuthError(error: unknown): boolean {
  return error instanceof Error && error.message.trim().toLowerCase().includes("invalid authentication token");
}

export function isSessionAuthTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message === SESSION_AUTH_TIMEOUT_MESSAGE;
}

export async function resolveSessionAuthToken(
  config: SessionAuthConfig,
  options: ResolveSessionAuthOptions = {}
): Promise<string> {
  const cachedToken = config.authToken?.trim() ?? "";
  const timeoutMs = Math.max(500, options.timeoutMs ?? 5000);
  const retryDelayMs = Math.max(50, options.retryDelayMs ?? 200);
  const preferFresh = options.preferFresh === true;

  if (!preferFresh && cachedToken) {
    return cachedToken;
  }

  if (!config.getAuthToken) {
    if (cachedToken) {
      return cachedToken;
    }
    throw new Error(SESSION_AUTH_TIMEOUT_MESSAGE);
  }

  let remainingMs = timeoutMs;
  while (remainingMs >= 0) {
    const nextToken = ((await config.getAuthToken()) ?? "").trim();
    if (nextToken) {
      return nextToken;
    }
    if (remainingMs === 0) {
      break;
    }
    const delayMs = Math.min(retryDelayMs, remainingMs);
    await wait(delayMs);
    remainingMs -= delayMs;
  }

  if (!preferFresh && cachedToken) {
    return cachedToken;
  }

  throw new Error(SESSION_AUTH_TIMEOUT_MESSAGE);
}

export async function runWithSessionAuthToken<T>(
  config: SessionAuthConfig,
  task: (resolvedAuthToken: string) => Promise<T>,
  options: ResolveSessionAuthOptions = {}
): Promise<T> {
  const firstToken = await resolveSessionAuthToken(config, options);

  try {
    return await task(firstToken);
  } catch (error) {
    if (!isInvalidAuthError(error) || !config.getAuthToken) {
      throw error;
    }

    const refreshedToken = await resolveSessionAuthToken(config, {
      ...options,
      preferFresh: true,
    });
    return await task(refreshedToken);
  }
}
