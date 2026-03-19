import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrainActivityIndicator } from "./BrainActivityIndicator";

describe("BrainActivityIndicator", () => {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("appears when a project reply completes", () => {
    render(<BrainActivityIndicator activityToken={1} enabled={true} />);
    expect(screen.getByText(/learning from this conversation/i)).toBeInTheDocument();
  });

  it("disappears after 3 seconds", async () => {
    vi.useFakeTimers();
    render(<BrainActivityIndicator activityToken={1} enabled={true} />);
    await vi.advanceTimersByTimeAsync(3000);
    expect(screen.queryByText(/learning from this conversation/i)).not.toBeInTheDocument();
  });

  it("does not appear for global chat", () => {
    render(<BrainActivityIndicator activityToken={1} enabled={false} />);
    expect(screen.queryByText(/learning from this conversation/i)).not.toBeInTheDocument();
  });
});
