import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectBrainPanel } from "./ProjectBrainPanel";

const {
  getProjectMemoryMock,
  getBrainLogMock,
  updateProjectMemoryFactMock,
  resetProjectBrainMock,
} = vi.hoisted(() => ({
  getProjectMemoryMock: vi.fn(),
  getBrainLogMock: vi.fn(),
  updateProjectMemoryFactMock: vi.fn(),
  resetProjectBrainMock: vi.fn(),
}));

vi.mock("../api/projects", () => ({
  getProjectMemory: getProjectMemoryMock,
  getBrainLog: getBrainLogMock,
  updateProjectMemoryFact: updateProjectMemoryFactMock,
  resetProjectBrain: resetProjectBrainMock,
}));

describe("ProjectBrainPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProjectMemoryMock.mockResolvedValue({
      memory: { startup_name: "NeuralChat", tech_stack: "FastAPI" },
      completeness: {
        percentage: 60,
        filled_keys: ["startup_name", "tech_stack"],
        missing_keys: ["business_model", "stage"],
        suggestion: "Tell me about your business model and stage.",
      },
    });
    getBrainLogMock.mockResolvedValue({
      log: [
        {
          timestamp: "2026-03-17T14:23:00Z",
          session_id: "chat-1",
          extracted_facts: { tech_stack: "FastAPI" },
          tokens_used: 150,
        },
      ],
    });
    updateProjectMemoryFactMock.mockResolvedValue({
      memory: { startup_name: "NewName", tech_stack: "FastAPI" },
    });
    resetProjectBrainMock.mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders completeness, filled facts, missing keys, and suggestion", async () => {
    render(<ProjectBrainPanel authToken="token" projectId="proj1" template="startup" />);

    await waitFor(() => {
      expect(screen.getByText("60%")).toBeInTheDocument();
    });
    expect(screen.getByText("Startup Name")).toBeInTheDocument();
    expect(screen.getByText("NeuralChat")).toBeInTheDocument();
    expect(screen.getByText("Business Model")).toBeInTheDocument();
    expect(screen.getByText("Stage")).toBeInTheDocument();
    expect(screen.getByText("Tell me about your business model and stage.")).toBeInTheDocument();
  });

  it("shows an input and saves on Enter when editing a fact", async () => {
    render(<ProjectBrainPanel authToken="token" projectId="proj1" template="startup" />);

    await waitFor(() => {
      expect(screen.getByText("Startup Name")).toBeInTheDocument();
    });

    await userEvent.click(screen.getAllByRole("button", { name: /edit startup name/i })[0]!);
    const input = screen.getByRole("textbox", { name: /edit startup name/i });
    await userEvent.clear(input);
    await userEvent.type(input, "NewName{enter}");

    await waitFor(() => {
      expect(updateProjectMemoryFactMock).toHaveBeenCalledWith("token", "proj1", "startup_name", "NewName", undefined);
    });
  });

  it("resets the brain after confirmation", async () => {
    render(<ProjectBrainPanel authToken="token" projectId="proj1" template="startup" />);

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /reset project brain/i })[0]).toBeInTheDocument();
    });

    getProjectMemoryMock.mockResolvedValueOnce({
      memory: {},
      completeness: { percentage: 0, filled_keys: [], missing_keys: ["startup_name"], suggestion: "" },
    });
    getBrainLogMock.mockResolvedValueOnce({ log: [] });

    await userEvent.click(screen.getAllByRole("button", { name: /reset project brain/i })[0]!);

    await waitFor(() => {
      expect(resetProjectBrainMock).toHaveBeenCalledWith("token", "proj1", undefined);
    });
  });

  it("keeps the brain log collapsed by default and expands on click", async () => {
    render(<ProjectBrainPanel authToken="token" projectId="proj1" template="startup" />);

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /what the ai learned recently/i })[0]).toBeInTheDocument();
    });

    expect(screen.queryByText(/learned: tech stack/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: /what the ai learned recently/i })[0]!);
    expect(screen.getByText(/learned: tech stack/i)).toBeInTheDocument();
  });

  it("registers a 30-second auto-refresh while open", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    render(<ProjectBrainPanel authToken="token" projectId="proj1" template="startup" />);

    await waitFor(() => {
      expect(getProjectMemoryMock).toHaveBeenCalledTimes(1);
    });

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);
  });

  it("prefers a fresh auth token when getAuthToken is available", async () => {
    const getAuthToken = vi.fn().mockResolvedValue("fresh-token");

    render(
      <ProjectBrainPanel
        authToken="stale-token"
        getAuthToken={getAuthToken}
        projectId="proj1"
        template="startup"
      />
    );

    await waitFor(() => {
      expect(getProjectMemoryMock).toHaveBeenCalledWith("fresh-token", "proj1", undefined);
    });
  });
});
