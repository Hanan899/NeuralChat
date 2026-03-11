import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authState, getTokenMock, streamChatMock } = vi.hoisted(() => ({
  authState: { signedIn: true },
  getTokenMock: vi.fn().mockResolvedValue("token"),
  streamChatMock: vi.fn().mockResolvedValue({
    requestId: "req-1",
    responseMs: 10,
    firstTokenMs: 5,
    tokensEmitted: 1
  })
}));

vi.mock("@clerk/clerk-react", () => ({
  SignedIn: ({ children }: { children: React.ReactNode }) => (authState.signedIn ? children : null),
  SignedOut: ({ children }: { children: React.ReactNode }) => (authState.signedIn ? null : children),
  SignIn: () => <div>Clerk Sign In</div>,
  UserButton: () => <div>UserButton</div>,
  useAuth: () => ({
    userId: "user_1",
    getToken: getTokenMock
  })
}));

vi.mock("../api", () => ({
  checkHealth: vi.fn().mockResolvedValue(true),
  streamChat: streamChatMock
}));

import App from "../App";

describe("App", () => {
  beforeEach(() => {
    authState.signedIn = true;
    getTokenMock.mockResolvedValue("token");
    streamChatMock.mockResolvedValue({
      requestId: "req-1",
      responseMs: 10,
      firstTokenMs: 5,
      tokensEmitted: 1
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders login screen when signed out", () => {
    authState.signedIn = false;
    render(<App />);

    expect(screen.getByText("NeuralChat")).toBeInTheDocument();
    expect(screen.getByText("Clerk Sign In")).toBeInTheDocument();
  });

  it("renders title and send button", () => {
    render(<App />);

    expect(screen.getByText("NeuralChat")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("sends bearer-authenticated chat request", async () => {
    render(<App />);

    await userEvent.type(screen.getByPlaceholderText("Ask NeuralChat anything..."), "hello");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(getTokenMock).toHaveBeenCalled();
    expect(streamChatMock).toHaveBeenCalledTimes(1);
    const [, tokenArg] = streamChatMock.mock.calls[0];
    expect(tokenArg).toBe("token");
  });
});
