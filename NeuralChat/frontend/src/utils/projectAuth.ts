import {
  isInvalidAuthError,
  isSessionAuthTimeoutError,
  resolveSessionAuthToken,
  runWithSessionAuthToken,
} from "./sessionAuth";

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

export { isInvalidAuthError };

export function isProjectAuthTimeoutError(error: unknown): boolean {
  return isSessionAuthTimeoutError(error) || (error instanceof Error && error.message === PROJECT_AUTH_TIMEOUT_MESSAGE);
}

export async function resolveProjectAuthToken(
  config: ProjectAuthConfig,
  options: ResolveProjectAuthOptions = {}
): Promise<string> {
  try {
    return await resolveSessionAuthToken(config, options);
  } catch (error) {
    if (isSessionAuthTimeoutError(error)) {
      throw new Error(PROJECT_AUTH_TIMEOUT_MESSAGE);
    }
    throw error;
  }
}

export async function runWithProjectAuthToken<T>(
  config: ProjectAuthConfig,
  task: (resolvedAuthToken: string) => Promise<T>,
  options: ResolveProjectAuthOptions = {}
): Promise<T> {
  return await runWithSessionAuthToken(config, task, options);
}
