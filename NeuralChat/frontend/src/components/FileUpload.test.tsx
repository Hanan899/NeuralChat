import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FileList } from "./FileList";
import { FileUpload } from "./FileUpload";
import { MessageBubble } from "./MessageBubble";

const {
  authState,
  getTokenMock,
  checkSearchStatusMock,
  streamChatMock,
  getFilesMock,
  deleteFileMock,
  deleteConversationSessionMock,
  uploadFileWithProgressMock,
  generateConversationTitleMock,
  createAgentPlanMock,
  runAgentMock,
  getAgentHistoryMock,
  getAgentTaskMock,
} = vi.hoisted(() => ({
  authState: { signedIn: true },
  getTokenMock: vi.fn().mockResolvedValue("token"),
  checkSearchStatusMock: vi.fn().mockResolvedValue(true),
  streamChatMock: vi.fn().mockResolvedValue({
    requestId: "req-1",
    responseMs: 10,
    firstTokenMs: 5,
    tokensEmitted: 1,
    searchUsed: false,
    fileContextUsed: false,
    sources: [],
  }),
  getFilesMock: vi.fn().mockResolvedValue({ files: [] }),
  deleteFileMock: vi.fn().mockResolvedValue({ message: "deleted" }),
  deleteConversationSessionMock: vi.fn().mockResolvedValue({
    message: "Conversation deleted successfully",
    conversation_deleted: true,
    uploads_deleted: 0,
    parsed_deleted: 0,
    plans_deleted: 0,
    logs_deleted: 0,
  }),
  uploadFileWithProgressMock: vi.fn().mockResolvedValue({
    filename: "doc.txt",
    blob_path: "user/sess/doc.txt",
    chunk_count: 1,
    message: "File uploaded successfully",
  }),
  generateConversationTitleMock: vi.fn().mockResolvedValue({ title: "Document Review" }),
  createAgentPlanMock: vi.fn(),
  runAgentMock: vi.fn(),
  getAgentHistoryMock: vi.fn().mockResolvedValue([]),
  getAgentTaskMock: vi.fn().mockResolvedValue({ plan: { plan_id: "plan-1", goal: "Goal", steps: [] }, log: [] }),
}));

vi.mock("../api", () => ({
  checkHealth: vi.fn().mockResolvedValue(true),
  checkSearchStatus: checkSearchStatusMock,
  streamChat: streamChatMock,
  getFiles: getFilesMock,
  deleteFile: deleteFileMock,
  deleteConversationSession: deleteConversationSessionMock,
  uploadFileWithProgress: uploadFileWithProgressMock,
  generateConversationTitle: generateConversationTitleMock,
}));

vi.mock("../api/agent", () => ({
  createAgentPlan: createAgentPlanMock,
  runAgent: runAgentMock,
  getAgentHistory: getAgentHistoryMock,
  getAgentTask: getAgentTaskMock,
}));

vi.mock("@clerk/clerk-react", () => ({
  SignedIn: ({ children }: { children: React.ReactNode }) => (authState.signedIn ? children : null),
  SignedOut: ({ children }: { children: React.ReactNode }) => (authState.signedIn ? null : children),
  SignIn: () => <div>Clerk Sign In</div>,
  useAuth: () => ({ userId: "user_1", getToken: getTokenMock }),
  useUser: () => ({
    user: {
      fullName: "Abdul Hanan",
      firstName: "Abdul",
      username: "hanan",
      primaryEmailAddress: { emailAddress: "hanan@example.com" },
    },
  }),
  useClerk: () => ({ signOut: vi.fn(), openUserProfile: vi.fn() }),
}));

import App from "../App";

describe("File upload and file context UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.signedIn = true;
    getTokenMock.mockResolvedValue("token");
    checkSearchStatusMock.mockResolvedValue(true);
    streamChatMock.mockResolvedValue({
      requestId: "req-1",
      responseMs: 10,
      firstTokenMs: 5,
      tokensEmitted: 1,
      searchUsed: false,
      fileContextUsed: false,
      sources: [],
    });
    getFilesMock.mockResolvedValue({ files: [] });
    deleteFileMock.mockResolvedValue({ message: "deleted" });
    uploadFileWithProgressMock.mockResolvedValue({
      filename: "doc.txt",
      blob_path: "user/sess/doc.txt",
      chunk_count: 1,
      message: "File uploaded successfully",
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("test_file_upload_renders_drag_drop_zone", () => {
    render(<FileUpload open={true} authToken="token" sessionId="session-1" onClose={vi.fn()} />);
    expect(screen.getByText(/Drag & drop or click to browse/i)).toBeInTheDocument();
  });

  it("test_file_upload_shows_progress_bar_during_upload", async () => {
    uploadFileWithProgressMock.mockImplementation(
      (_token: string, _sessionId: string, _file: File, onProgress: (value: number) => void) =>
        new Promise((resolve) => {
          onProgress(50);
          setTimeout(
            () =>
              resolve({
                filename: "doc.txt",
                blob_path: "user/sess/doc.txt",
                chunk_count: 1,
                message: "File uploaded successfully",
              }),
            40
          );
        })
    );

    render(<FileUpload open={true} authToken="token" sessionId="session-1" onClose={vi.fn()} />);

    const fileInput = screen.getByLabelText("Browse files") as HTMLInputElement;
    const file = new File(["hello"], "doc.txt", { type: "text/plain" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(await screen.findByText("50%")).toBeInTheDocument();
  });

  it("test_file_upload_shows_error_for_wrong_file_type", async () => {
    uploadFileWithProgressMock.mockRejectedValue(new Error("File type .exe is not supported."));

    render(<FileUpload open={true} authToken="token" sessionId="session-1" onClose={vi.fn()} />);

    const fileInput = screen.getByLabelText("Browse files") as HTMLInputElement;
    const file = new File(["binary"], "virus.exe", { type: "application/octet-stream" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(await screen.findByText(/File type \.exe is not supported/i)).toBeInTheDocument();
  });

  it("test_file_upload_adds_file_to_list_on_success", async () => {
    getFilesMock.mockResolvedValueOnce({ files: [] }).mockResolvedValueOnce({
      files: [{ filename: "doc.txt", uploaded_at: "2026-03-12T10:00:00Z", blob_path: "user/sess/doc.txt" }],
    });

    render(<FileUpload open={true} authToken="token" sessionId="session-1" onClose={vi.fn()} />);

    const fileInput = screen.getByLabelText("Browse files") as HTMLInputElement;
    const file = new File(["hello"], "doc.txt", { type: "text/plain" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(await screen.findByText("doc.txt")).toBeInTheDocument();
  });

  it("passes naming context into file upload requests", async () => {
    render(
      <FileUpload
        open={true}
        authToken="token"
        sessionId="session-1"
        naming={{ userDisplayName: "Abdul Hanan", sessionTitle: "Roadmap review" }}
        onClose={vi.fn()}
      />
    );

    const fileInput = screen.getByLabelText("Browse files") as HTMLInputElement;
    const file = new File(["hello"], "doc.txt", { type: "text/plain" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(uploadFileWithProgressMock).toHaveBeenCalledWith(
        "token",
        "session-1",
        expect.any(File),
        expect.any(Function),
        { userDisplayName: "Abdul Hanan", sessionTitle: "Roadmap review" }
      );
    });
  });

  it("test_file_list_renders_uploaded_files", async () => {
    getFilesMock.mockResolvedValueOnce({
      files: [
        { filename: "first.pdf", uploaded_at: "", blob_path: "user/sess/first.pdf" },
        { filename: "second.txt", uploaded_at: "", blob_path: "user/sess/second.txt" },
      ],
    });

    render(<FileList authToken="token" sessionId="session-1" refreshKey={0} />);

    expect(await screen.findByText("first.pdf")).toBeInTheDocument();
    expect(screen.getByText("second.txt")).toBeInTheDocument();
  });

  it("test_file_list_shows_empty_state_when_no_files", async () => {
    getFilesMock.mockResolvedValueOnce({ files: [] });

    render(<FileList authToken="token" sessionId="session-1" refreshKey={0} />);

    expect(await screen.findByText(/No files uploaded yet/i)).toBeInTheDocument();
  });

  it("test_delete_file_removes_from_list", async () => {
    getFilesMock.mockResolvedValueOnce({
      files: [
        { filename: "doc.pdf", uploaded_at: "", blob_path: "user/sess/doc.pdf" },
        { filename: "notes.txt", uploaded_at: "", blob_path: "user/sess/notes.txt" },
      ],
    });

    render(<FileList authToken="token" sessionId="session-1" refreshKey={0} />);

    expect(await screen.findByText("doc.pdf")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete doc.pdf" }));

    await waitFor(() => {
      expect(screen.queryByText("doc.pdf")).not.toBeInTheDocument();
    });
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
  });

  it("test_paperclip_badge_shows_file_count", async () => {
    getFilesMock.mockResolvedValue({
      files: [
        { filename: "one.pdf", uploaded_at: "", blob_path: "user/sess/one.pdf" },
        { filename: "two.pdf", uploaded_at: "", blob_path: "user/sess/two.pdf" },
      ],
    });

    render(<App />);

    expect(await screen.findByRole("button", { name: "Add files to this chat" })).toBeInTheDocument();
    expect(screen.queryByText("2 files attached")).not.toBeInTheDocument();
  });

  it("test_file_context_badge_shows_on_message", () => {
    render(
      <MessageBubble
        showAssistantLabel={true}
        message={{
          id: "assistant-1",
          role: "assistant",
          content: "Answer with file context",
          createdAt: new Date().toISOString(),
          model: "gpt-5",
          fileContextUsed: true,
          searchUsed: false,
          sources: [],
        }}
      />
    );

    expect(screen.getByLabelText("File context used")).toBeInTheDocument();
  });

  it("test_file_context_badge_hidden_without_files", () => {
    render(
      <MessageBubble
        showAssistantLabel={true}
        message={{
          id: "assistant-2",
          role: "assistant",
          content: "Answer without file context",
          createdAt: new Date().toISOString(),
          model: "gpt-5",
          fileContextUsed: false,
          searchUsed: false,
          sources: [],
        }}
      />
    );

    expect(screen.queryByLabelText("File context used")).not.toBeInTheDocument();
  });
});
