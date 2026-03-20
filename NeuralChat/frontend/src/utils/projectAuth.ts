const PROJECT_AUTH_TIMEOUT_MESSAGE = "PROJECT_AUTH_TIMEOUT";

type ProjectAuthConfig = {
  authToken?: string;
  getAuthToken?: () => Promise<string | null>;
};

type ResolveProjectAuthOptions = {
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

export function isProjectAuthTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message === PROJECT_AUTH_TIMEOUT_MESSAGE;
}

export async function resolveProjectAuthToken(
  config: ProjectAuthConfig,
  options: ResolveProjectAuthOptions = {}
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
    throw new Error(PROJECT_AUTH_TIMEOUT_MESSAGE);
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

  throw new Error(PROJECT_AUTH_TIMEOUT_MESSAGE);
}

export async function runWithProjectAuthToken<T>(
  config: ProjectAuthConfig,
  task: (resolvedAuthToken: string) => Promise<T>,
  options: ResolveProjectAuthOptions = {}
): Promise<T> {
  const firstToken = await resolveProjectAuthToken(config, options);

  try {
    return await task(firstToken);
  } catch (error) {
    if (!isInvalidAuthError(error) || !config.getAuthToken) {
      throw error;
    }

    const refreshedToken = await resolveProjectAuthToken(config, {
      ...options,
      preferFresh: true,
    });
    return await task(refreshedToken);
  }
}
