import { afterEach, describe, expect, it, vi } from "vitest";

import { isProjectAuthTimeoutError, resolveProjectAuthToken, runWithProjectAuthToken } from "./projectAuth";

describe("projectAuth", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("resolves the cached token immediately", async () => {
    const getAuthToken = vi.fn();

    const token = await resolveProjectAuthToken({ authToken: "cached-token", getAuthToken });

    expect(token).toBe("cached-token");
    expect(getAuthToken).not.toHaveBeenCalled();
  });

  it("retries until a fresh token becomes available", async () => {
    vi.useFakeTimers();
    const getAuthToken = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("fresh-token");

    const tokenPromise = resolveProjectAuthToken(
      { authToken: "", getAuthToken },
      { timeoutMs: 1000, retryDelayMs: 100 }
    );

    await vi.runAllTimersAsync();
    await expect(tokenPromise).resolves.toBe("fresh-token");
  });

  it("retries once with a fresh token after an invalid token error", async () => {
    const getAuthToken = vi.fn().mockResolvedValue("fresh-token");
    const task = vi
      .fn()
      .mockRejectedValueOnce(new Error("Invalid authentication token."))
      .mockResolvedValueOnce("ok");

    await expect(runWithProjectAuthToken({ authToken: "stale-token", getAuthToken }, task)).resolves.toBe("ok");

    expect(task).toHaveBeenNthCalledWith(1, "stale-token");
    expect(task).toHaveBeenNthCalledWith(2, "fresh-token");
  });

  it("fails cleanly after timing out", async () => {
    const getAuthToken = vi.fn().mockResolvedValue(null);

    await expect(
      resolveProjectAuthToken(
      { authToken: "", getAuthToken },
      { timeoutMs: 300, retryDelayMs: 100 }
      )
    ).rejects.toSatisfy(isProjectAuthTimeoutError);
  }, 7000);
});
