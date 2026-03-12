import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getMeMock, patchMemoryMock, deleteMemoryMock, checkHealthMock, checkSearchStatusMock, streamChatMock, authState, getTokenMock } =
  vi.hoisted(() => ({
    getMeMock: vi.fn(),
    patchMemoryMock: vi.fn(),
    deleteMemoryMock: vi.fn(),
    checkHealthMock: vi.fn().mockResolvedValue(true),
    checkSearchStatusMock: vi.fn().mockResolvedValue(false),
    streamChatMock: vi.fn(),
    authState: { signedIn: true },
    getTokenMock: vi.fn().mockResolvedValue("token"),
  }));

vi.mock("../api", () => ({
  getMe: getMeMock,
  patchMemory: patchMemoryMock,
  deleteMemory: deleteMemoryMock,
  checkHealth: checkHealthMock,
  checkSearchStatus: checkSearchStatusMock,
  streamChat: streamChatMock,
}));

vi.mock("@clerk/clerk-react", () => ({
  SignedIn: ({ children }: { children: React.ReactNode }) => (authState.signedIn ? children : null),
  SignedOut: ({ children }: { children: React.ReactNode }) => (authState.signedIn ? null : children),
  SignIn: () => <div>Clerk Sign In</div>,
  UserButton: () => <div>UserButton</div>,
  useAuth: () => ({
    userId: "user_1",
    getToken: getTokenMock,
  }),
  useUser: () => ({
    user: {
      fullName: "Abdul Hanan",
      firstName: "Abdul",
      username: "hanan",
      primaryEmailAddress: {
        emailAddress: "hanan@example.com"
      }
    }
  }),
}));

import { MemoryPanel } from "./MemoryPanel";

describe("MemoryPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.signedIn = true;
    getTokenMock.mockResolvedValue("token");
    getMeMock.mockResolvedValue({ user_id: "user_1", profile: {} });
    patchMemoryMock.mockResolvedValue({ user_id: "user_1", profile: {} });
    deleteMemoryMock.mockResolvedValue({ message: "Memory cleared" });
  });

  afterEach(() => {
    cleanup();
  });

  it("test_memory_panel_renders_facts_from_api", async () => {
    getMeMock.mockResolvedValue({
      user_id: "user_1",
      profile: { name: "Ali", job: "Engineer" },
    });

    render(<MemoryPanel isOpen={true} onClose={() => undefined} getAuthToken={getTokenMock} />);

    expect(await screen.findByText("name")).toBeInTheDocument();
    expect(screen.getByText("Ali")).toBeInTheDocument();
    expect(screen.getByText("job")).toBeInTheDocument();
    expect(screen.getByText("Engineer")).toBeInTheDocument();
  });

  it("test_memory_panel_shows_empty_state_when_no_facts", async () => {
    getMeMock.mockResolvedValue({ user_id: "user_1", profile: {} });
    render(<MemoryPanel isOpen={true} onClose={() => undefined} getAuthToken={getTokenMock} />);
    expect(await screen.findByText("No memory yet — start chatting!")).toBeInTheDocument();
  });

  it("test_memory_panel_shows_loading_skeleton_while_fetching", async () => {
    getMeMock.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ user_id: "user_1", profile: { name: "Ali" } }), 100)
        )
    );

    render(<MemoryPanel isOpen={true} onClose={() => undefined} getAuthToken={getTokenMock} />);
    expect(screen.getAllByTestId("memory-skeleton").length).toBeGreaterThan(0);
    expect(await screen.findByText("Ali")).toBeInTheDocument();
  });

  it("renders object memory values without crashing", async () => {
    getMeMock.mockResolvedValue({
      user_id: "user_1",
      profile: { preferences: { style: "concise", language: "en" } }
    });

    render(<MemoryPanel isOpen={true} onClose={() => undefined} getAuthToken={getTokenMock} />);

    expect(await screen.findByText("preferences")).toBeInTheDocument();
    expect(screen.getByText("style: concise | language: en")).toBeInTheDocument();
  });

  it("hides technical profile keys from user panel", async () => {
    getMeMock.mockResolvedValue({
      user_id: "user_1",
      profile: {
        user_id: "internal-user",
        updated_at: "2026-03-11T22:54:16Z",
        city: "Lahore"
      }
    });

    render(<MemoryPanel isOpen={true} onClose={() => undefined} getAuthToken={getTokenMock} />);

    expect(await screen.findByText("city")).toBeInTheDocument();
    expect(screen.queryByText("user_id")).not.toBeInTheDocument();
    expect(screen.queryByText("updated_at")).not.toBeInTheDocument();
  });

  it("test_edit_fact_calls_patch_endpoint", async () => {
    getMeMock.mockResolvedValue({ user_id: "user_1", profile: { name: "Ali" } });
    patchMemoryMock.mockResolvedValue({ user_id: "user_1", profile: { name: "Bob" } });

    render(<MemoryPanel isOpen={true} onClose={() => undefined} getAuthToken={getTokenMock} />);

    await screen.findByText("Ali");
    await userEvent.click(screen.getByText("Edit"));

    const editInput = screen.getByDisplayValue("Ali");
    await userEvent.clear(editInput);
    await userEvent.type(editInput, "Bob");
    fireEvent.keyDown(editInput, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(patchMemoryMock).toHaveBeenCalledWith("token", "name", "Bob");
    });
  });

  it("test_clear_all_memory_calls_delete_endpoint_and_clears_ui", async () => {
    getMeMock.mockResolvedValue({ user_id: "user_1", profile: { name: "Ali" } });

    render(<MemoryPanel isOpen={true} onClose={() => undefined} getAuthToken={getTokenMock} />);
    await screen.findByText("Ali");

    await userEvent.click(screen.getByText("Clear All Memory"));

    await waitFor(() => {
      expect(deleteMemoryMock).toHaveBeenCalledWith("token");
    });
    expect(await screen.findByText("No memory yet — start chatting!")).toBeInTheDocument();
  });

});
