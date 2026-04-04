import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { TokenContextMeter } from "./TokenContextMeter";

describe("TokenContextMeter", () => {
  it("renders latest request usage and session totals in the popover", async () => {
    render(
      <TokenContextMeter
        latestUsage={{
          inputTokens: 7_944,
          outputTokens: 8_209,
          totalTokens: 16_153,
          contextWindowTokens: 262_144,
          contextPercentageUsed: 6.2,
        }}
        sessionTotals={{
          inputTokens: 9_100,
          outputTokens: 8_800,
          totalTokens: 17_900,
        }}
      />
    );

    const trigger = screen.getByRole("button", { name: /latest request used/i });
    expect(trigger).toHaveTextContent("16.2k / 262.1k");

    await userEvent.click(trigger);

    expect(screen.getByRole("dialog", { name: "Token usage details" })).toBeInTheDocument();
    expect(screen.getByText("Context usage")).toBeInTheDocument();
    expect(screen.getByText("6.2%")).toBeInTheDocument();
    expect(screen.getByText("7,944")).toBeInTheDocument();
    expect(screen.getByText("8,209")).toBeInTheDocument();
    expect(screen.getByText("17,900")).toBeInTheDocument();
  });

  it("shows a quiet unavailable state when no usage exists yet", async () => {
    render(
      <TokenContextMeter
        latestUsage={null}
        sessionTotals={{
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        }}
      />
    );

    const trigger = screen.getByRole("button", { name: /token usage unavailable/i });
    expect(trigger).toHaveTextContent("Usage unavailable");

    await userEvent.click(trigger);

    expect(screen.getByText("Send a message in this chat to populate token usage.")).toBeInTheDocument();
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });
});
