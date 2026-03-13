import { SignIn, SignedIn, SignedOut, useAuth, useClerk, useUser } from "@clerk/clerk-react";
import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { checkHealth, checkSearchStatus, getFiles, streamChat } from "./api";
import { createAgentPlan, runAgent } from "./api/agent";
import { AgentHistory } from "./components/AgentHistory";
import { ChatWindow } from "./components/ChatWindow";
import { DebugPanel } from "./components/DebugPanel";
import { FileUpload } from "./components/FileUpload";
import { ModelSelector } from "./components/ModelSelector";
import { Sidebar } from "./components/Sidebar";
import type {
  AgentPlan,
  AgentStepResult,
  AgentTaskState,
  ChatMessage,
  ChatModel,
  ConversationSummary,
  StreamChunk,
  ThemeMode,
  UploadedFileItem,
} from "./types";

const EMPTY_SUGGESTIONS = [
  "Summarize this project architecture in simple terms",
  "Help me debug my API latency",
  "Write a clean README section for setup",
  "Give me a step-by-step learning path"
];

const THEME_STORAGE_KEY = "neuralchat:theme-mode:v1";
type ToastTone = "success" | "info" | "error";

interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
}

const SIGN_IN_APPEARANCE = {
  variables: {
    colorPrimary: "#d97757",
    colorText: "#ececec",
    colorTextSecondary: "#9b9995",
    colorBackground: "#1e1d1c",
    colorInputBackground: "#262524",
    colorInputText: "#ececec",
    colorDanger: "#ff8b8b",
    borderRadius: "12px",
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
  },
  layout: {
    socialButtonsPlacement: "top",
    socialButtonsVariant: "blockButton"
  },
  elements: {
    rootBox: "nc-clerk-root",
    cardBox: "nc-clerk-card-box",
    card: "nc-clerk-card",
    header: "nc-clerk-header",
    headerTitle: "nc-clerk-header-title",
    headerSubtitle: "nc-clerk-header-subtitle",
    formButtonPrimary: "nc-clerk-button-primary",
    socialButtonsBlockButton: "nc-clerk-social-button",
    socialButtonsBlockButtonText: "nc-clerk-social-button-text",
    formFieldLabel: "nc-clerk-field-label",
    formFieldInput: "nc-clerk-input",
    dividerLine: "nc-clerk-divider-line",
    dividerText: "nc-clerk-divider-text",
    footer: "nc-clerk-footer",
    footerActionText: "nc-clerk-footer-text",
    footerActionLink: "nc-clerk-footer-link",
    identityPreviewText: "nc-clerk-identity-text",
    formResendCodeLink: "nc-clerk-footer-link",
    alertText: "nc-clerk-alert-text"
  }
};

function UiIcon({
  kind,
  className
}: {
  kind: "brand" | "attach" | "search" | "send" | "stop" | "menu" | "agent";
  className?: string;
}) {
  if (kind === "brand") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={className}>
        <circle cx="12" cy="12" r="8.3" stroke="currentColor" strokeWidth="1.7" />
        <path d="M8 12C8 9.8 9.8 8 12 8C14.2 8 16 9.8 16 12C16 14.2 14.2 16 12 16" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }

  if (kind === "attach") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={className}>
        <path
          d="M9.5 12.5L14.8 7.2C16.2 5.8 18.4 5.8 19.8 7.2C21.2 8.6 21.2 10.8 19.8 12.2L11.3 20.7C8.9 23.1 5 23.1 2.6 20.7C0.2 18.3 0.2 14.4 2.6 12L11.1 3.5"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (kind === "search") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={className}>
        <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" />
        <path d="M16 16L20 20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M11 4.5V17.5M4.5 11H17.5" stroke="currentColor" strokeWidth="1.2" opacity="0.65" />
      </svg>
    );
  }

  if (kind === "stop") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className={className}>
        <rect x="7" y="7" width="10" height="10" rx="2" />
      </svg>
    );
  }

  if (kind === "menu") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={className}>
        <path d="M5 8H19M5 12H19M5 16H19" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }

  if (kind === "agent") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={className}>
        <rect x="7" y="8" width="10" height="8" rx="3" stroke="currentColor" strokeWidth="1.7" />
        <path d="M12 4V8M9 18H15M8 21H16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="10" cy="12" r="0.8" fill="currentColor" />
        <circle cx="14" cy="12" r="0.8" fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 6V18M6 12H18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M12 6L15 9M12 6L9 9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function buildId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toTitleFromPrompt(prompt: string): string {
  const clean = prompt.trim();
  if (!clean) {
    return "New chat";
  }
  return clean.length > 56 ? `${clean.slice(0, 56)}...` : clean;
}

function getUserStorageKey(userId: string) {
  return `neuralchat:workspace-ui:v2:${userId}`;
}

function buildConversationSummary(title = "New chat"): ConversationSummary {
  return {
    id: `c-${crypto.randomUUID()}`,
    title,
    preview: "",
    updatedAt: new Date().toISOString()
  };
}

function buildAgentTaskState(plan: AgentPlan): AgentTaskState {
  return {
    plan,
    stepResults: [],
    runningStepNumber: null,
    summary: "",
    warning: "",
    status: "preview",
    error: "",
    stepsCompleted: 0,
  };
}

function resolveDisplayName(
  user:
    | {
        fullName?: string | null;
        firstName?: string | null;
        username?: string | null;
        primaryEmailAddress?: { emailAddress?: string | null } | null;
      }
    | null
    | undefined,
  fallbackUserId: string | null | undefined
): string {
  const preferredName =
    user?.fullName?.trim() ||
    user?.firstName?.trim() ||
    user?.username?.trim() ||
    user?.primaryEmailAddress?.emailAddress?.split("@")[0]?.trim();

  if (preferredName) {
    return preferredName;
  }

  if (fallbackUserId) {
    return fallbackUserId;
  }

  return "NeuralChat User";
}

function resolveUserSubtitle(
  user:
    | {
        primaryEmailAddress?: { emailAddress?: string | null } | null;
      }
    | null
    | undefined
): string {
  const emailAddress = user?.primaryEmailAddress?.emailAddress?.trim();
  if (emailAddress) {
    return emailAddress;
  }
  return "Personal account";
}

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "system" || value === "dark" || value === "light";
}

function readInitialThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "system";
  }

  const savedThemeMode = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (isThemeMode(savedThemeMode)) {
    return savedThemeMode;
  }

  return "system";
}

function readSystemTheme(): "dark" | "light" {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "dark";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function ChatShell() {
  const { getToken, userId } = useAuth();
  const clerk = useClerk();
  const { user } = useUser();
  const [input, setInput] = useState("");
  const [model, setModel] = useState<ChatModel>("gpt-5");
  const [isSending, setIsSending] = useState(false);
  const [backendHealthy, setBackendHealthy] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [responseMs, setResponseMs] = useState<number | null>(null);
  const [firstTokenMs, setFirstTokenMs] = useState<number | null>(null);
  const [tokensEmitted, setTokensEmitted] = useState(0);
  const [streamStatus, setStreamStatus] = useState("idle");
  const [errorText, setErrorText] = useState("");
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readInitialThemeMode());
  const [systemTheme, setSystemTheme] = useState<"dark" | "light">(() => readSystemTheme());
  const [searchEnabled, setSearchEnabled] = useState<boolean | null>(null);
  const [forceWebSearch, setForceWebSearch] = useState(false);
  const [isAgentMode, setIsAgentMode] = useState(false);
  const [activeStreamingAssistantId, setActiveStreamingAssistantId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState("");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, ChatMessage[]>>({});
  const [fileCountsByConversation, setFileCountsByConversation] = useState<Record<string, number>>({});
  const [filesByConversation, setFilesByConversation] = useState<Record<string, UploadedFileItem[]>>({});
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [isFileModalOpen, setIsFileModalOpen] = useState(false);
  const [fileModalAuthToken, setFileModalAuthToken] = useState("");
  const [isAgentHistoryOpen, setIsAgentHistoryOpen] = useState(false);
  const [agentHistoryAuthToken, setAgentHistoryAuthToken] = useState("");

  const abortControllerRef = useRef<AbortController | null>(null);
  const submitLockRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const toastTimersRef = useRef<Record<string, ReturnType<typeof window.setTimeout>>>({});
  const typingQueueRef = useRef<string[]>([]);
  const typingTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const typingTargetRef = useRef<{ conversationId: string; assistantId: string } | null>(null);
  const typingFinishWhenEmptyRef = useRef(false);

  const searchReady = searchEnabled === true;
  const resolvedThemeMode: "dark" | "light" = themeMode === "system" ? systemTheme : themeMode;
  const userDisplayName = resolveDisplayName(user, userId);
  const userSubtitle = resolveUserSubtitle(user);
  const sortedConversations = useMemo(
    () => [...conversations].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()),
    [conversations]
  );
  const historyItems = useMemo(
    () => sortedConversations.filter((conversation) => conversation.archived !== true),
    [sortedConversations]
  );
  const archivedHistoryItems = useMemo(
    () => sortedConversations.filter((conversation) => conversation.archived === true),
    [sortedConversations]
  );

  const currentMessages = activeConversationId ? messagesByConversation[activeConversationId] ?? [] : [];
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId) ?? null;
  const activeFiles = activeConversationId ? filesByConversation[activeConversationId] ?? [] : [];

  useEffect(() => {
    checkHealth().then(setBackendHealthy).catch(() => setBackendHealthy(false));
    checkSearchStatus()
      .then((status) => setSearchEnabled(status))
      .catch(() => setSearchEnabled(false));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQueryList = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? "dark" : "light");
    };

    setSystemTheme(mediaQueryList.matches ? "dark" : "light");
    if (typeof mediaQueryList.addEventListener === "function") {
      mediaQueryList.addEventListener("change", syncSystemTheme);
      return () => mediaQueryList.removeEventListener("change", syncSystemTheme);
    }

    mediaQueryList.addListener(syncSystemTheme);
    return () => mediaQueryList.removeListener(syncSystemTheme);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    }

    document.documentElement.setAttribute("data-theme", resolvedThemeMode);
    document.documentElement.style.colorScheme = resolvedThemeMode;
  }, [themeMode, resolvedThemeMode]);

  useEffect(() => {
    return () => {
      Object.values(toastTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
      toastTimersRef.current = {};
      if (typingTimerRef.current) {
        window.clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      return;
    }

    const storageKey = getUserStorageKey(userId);
    const serialized = window.localStorage.getItem(storageKey);

    if (!serialized) {
      const summary = buildConversationSummary();
      setConversations([summary]);
      setMessagesByConversation({ [summary.id]: [] });
      setActiveConversationId(summary.id);
      return;
    }

    try {
      const parsed = JSON.parse(serialized) as {
        conversations?: ConversationSummary[];
        messagesByConversation?: Record<string, ChatMessage[]>;
        activeConversationId?: string;
      };

      const loadedConversations = Array.isArray(parsed.conversations) ? parsed.conversations : [];
      const loadedMessages = parsed.messagesByConversation ?? {};
      const normalizedConversations = loadedConversations.map((conversation) => ({
        ...conversation,
        archived: conversation.archived === true
      }));

      if (normalizedConversations.length === 0) {
        const summary = buildConversationSummary();
        setConversations([summary]);
        setMessagesByConversation({ [summary.id]: [] });
        setActiveConversationId(summary.id);
        return;
      }

      setConversations(normalizedConversations);
      setMessagesByConversation(loadedMessages);
      setActiveConversationId(parsed.activeConversationId ?? normalizedConversations[0].id);
    } catch {
      const summary = buildConversationSummary();
      setConversations([summary]);
      setMessagesByConversation({ [summary.id]: [] });
      setActiveConversationId(summary.id);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId || !activeConversationId) {
      return;
    }
    window.localStorage.setItem(
      getUserStorageKey(userId),
      JSON.stringify({
        conversations,
        messagesByConversation,
        activeConversationId
      })
    );
  }, [userId, conversations, messagesByConversation, activeConversationId]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "0px";
    const nextHeight = Math.min(textarea.scrollHeight, 200);
    textarea.style.height = `${nextHeight}px`;
  }, [input]);

  useEffect(() => {
    if (!activeConversationId || !userId) {
      return;
    }

    if (filesByConversation[activeConversationId]) {
      return;
    }

    let isCancelled = false;

    async function loadConversationFiles() {
      try {
        const authToken = await getToken();
        if (!authToken) {
          return;
        }

        const payload = await getFiles(authToken, activeConversationId);
        if (isCancelled) {
          return;
        }

        setFilesByConversation((previous) => ({
          ...previous,
          [activeConversationId]: payload.files
        }));
        setFileCountsByConversation((previous) => ({
          ...previous,
          [activeConversationId]: payload.files.length
        }));
      } catch {
        if (isCancelled) {
          return;
        }
        setFilesByConversation((previous) => ({
          ...previous,
          [activeConversationId]: []
        }));
        setFileCountsByConversation((previous) => ({
          ...previous,
          [activeConversationId]: 0
        }));
      }
    }

    void loadConversationFiles();

    return () => {
      isCancelled = true;
    };
  }, [activeConversationId, userId, getToken, filesByConversation]);

  function updateConversationSummary(conversationId: string, prompt: string, replyPreview: string) {
    setConversations((previous) =>
      previous.map((conversation) => {
        if (conversation.id !== conversationId) {
          return conversation;
        }

        return {
          ...conversation,
          title: conversation.title === "New chat" ? toTitleFromPrompt(prompt) : conversation.title,
          preview: replyPreview || prompt,
          updatedAt: new Date().toISOString()
        };
      })
    );
  }

  const updateAgentMessageState = useCallback(
    (conversationId: string, messageId: string, updater: (currentTask: AgentTaskState) => AgentTaskState) => {
      setMessagesByConversation((previous) => ({
        ...previous,
        [conversationId]: (previous[conversationId] ?? []).map((message) => {
          if (message.id !== messageId || !message.agentTask) {
            return message;
          }
          return {
            ...message,
            agentTask: updater(message.agentTask),
          };
        }),
      }));
    },
    []
  );

  function removeToast(toastId: string) {
    setToasts((previous) => previous.filter((toast) => toast.id !== toastId));
    const timerId = toastTimersRef.current[toastId];
    if (timerId) {
      window.clearTimeout(timerId);
      delete toastTimersRef.current[toastId];
    }
  }

  function showToast(message: string, tone: ToastTone = "info") {
    const toastId = `toast-${buildId()}`;
    setToasts((previous) => [...previous, { id: toastId, message, tone }]);
    toastTimersRef.current[toastId] = window.setTimeout(() => {
      removeToast(toastId);
    }, 2600);
  }

  const flushTypingQueue = useCallback(() => {
    typingTimerRef.current = null;

    const target = typingTargetRef.current;
    if (!target) {
      typingQueueRef.current = [];
      typingFinishWhenEmptyRef.current = false;
      return;
    }

    if (typingQueueRef.current.length === 0) {
      if (typingFinishWhenEmptyRef.current) {
        typingFinishWhenEmptyRef.current = false;
        typingTargetRef.current = null;
        setActiveStreamingAssistantId(null);
      }
      return;
    }

    const nextSlice = typingQueueRef.current.splice(0, 3).join("");

    setMessagesByConversation((previous) => ({
      ...previous,
      [target.conversationId]: (previous[target.conversationId] ?? []).map((message) =>
        message.id === target.assistantId ? { ...message, content: `${message.content}${nextSlice}` } : message
      )
    }));

    if (typingQueueRef.current.length > 0) {
      typingTimerRef.current = window.setTimeout(() => {
        flushTypingQueue();
      }, 18);
      return;
    }

    if (typingFinishWhenEmptyRef.current) {
      typingFinishWhenEmptyRef.current = false;
      typingTargetRef.current = null;
      setActiveStreamingAssistantId(null);
    }
  }, []);

  const scheduleTypingFlush = useCallback(() => {
    if (typingTimerRef.current || typingQueueRef.current.length === 0) {
      return;
    }

    typingTimerRef.current = window.setTimeout(() => {
      flushTypingQueue();
    }, 18);
  }, [flushTypingQueue]);

  const finishStreamingDisplay = useCallback(() => {
    if (typingQueueRef.current.length === 0) {
      typingFinishWhenEmptyRef.current = false;
      typingTargetRef.current = null;
      setActiveStreamingAssistantId(null);
      return;
    }

    typingFinishWhenEmptyRef.current = true;
    scheduleTypingFlush();
  }, [scheduleTypingFlush]);

  function handleNewChat() {
    const next = buildConversationSummary();
    setConversations((previous) => [next, ...previous]);
    setMessagesByConversation((previous) => ({ ...previous, [next.id]: [] }));
    setFilesByConversation((previous) => ({ ...previous, [next.id]: [] }));
    setFileCountsByConversation((previous) => ({ ...previous, [next.id]: 0 }));
    setActiveConversationId(next.id);
    setInput("");
    setErrorText("");
    setIsSidebarOpen(false);
  }

  function handleSelectConversation(conversationId: string) {
    if (isSending) {
      return;
    }
    setActiveConversationId(conversationId);
    setErrorText("");
  }

  function pickFallbackConversationId(
    nextConversations: ConversationSummary[],
    preferredConversationId?: string
  ): string | null {
    if (preferredConversationId) {
      const preferred = nextConversations.find((conversation) => conversation.id === preferredConversationId);
      if (preferred) {
        return preferred.id;
      }
    }

    const firstUnarchived = nextConversations.find((conversation) => conversation.archived !== true);
    if (firstUnarchived) {
      return firstUnarchived.id;
    }

    return nextConversations[0]?.id ?? null;
  }

  function handleToggleArchiveConversation(conversationId: string) {
    if (isSending) {
      return;
    }

    const wasArchived = conversations.find((conversation) => conversation.id === conversationId)?.archived === true;

    setConversations((previous) => {
      const next = previous.map((conversation) =>
        conversation.id === conversationId ? { ...conversation, archived: conversation.archived !== true } : conversation
      );

      const updated = next.find((conversation) => conversation.id === conversationId);
      if (!updated) {
        return previous;
      }

      if (activeConversationId === conversationId && updated.archived === true) {
        const fallbackId = pickFallbackConversationId(next, undefined);
        if (fallbackId) {
          setActiveConversationId(fallbackId);
        } else {
          const createdConversation = buildConversationSummary();
          setMessagesByConversation((previousMessages) => ({
            ...previousMessages,
            [createdConversation.id]: []
          }));
          setActiveConversationId(createdConversation.id);
          return [createdConversation];
        }
      }

      return next;
    });

    showToast(wasArchived ? "Chat restored from archive." : "Chat archived.", "success");
    setErrorText("");
  }

  function handleDeleteConversation(conversationId: string) {
    if (isSending) {
      return;
    }

    setMessagesByConversation((previous) => {
      const next = { ...previous };
      delete next[conversationId];
      return next;
    });

    setConversations((previous) => {
      let next = previous.filter((conversation) => conversation.id !== conversationId);

      if (next.length === 0) {
        const createdConversation = buildConversationSummary();
        next = [createdConversation];
        setMessagesByConversation((previousMessages) => ({
          ...Object.fromEntries(
            Object.entries(previousMessages).filter(([existingConversationId]) => existingConversationId !== conversationId)
          ),
          [createdConversation.id]: []
        }));
        setActiveConversationId(createdConversation.id);
        return next;
      }

      if (activeConversationId === conversationId) {
        const fallbackId = pickFallbackConversationId(next, undefined);
        if (fallbackId) {
          setActiveConversationId(fallbackId);
        }
      }

      return next;
    });
    setFileCountsByConversation((previous) => {
      const next = { ...previous };
      delete next[conversationId];
      return next;
    });

    showToast("Chat deleted.", "success");
    setErrorText("");
  }

  async function handleShareConversation(conversationId: string) {
    const conversation = conversations.find((item) => item.id === conversationId);
    const messages = messagesByConversation[conversationId] ?? [];
    const title = conversation?.title?.trim() || "NeuralChat chat";
    const transcript =
      messages.length > 0
        ? messages
            .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content || "(empty)"}`)
            .join("\n\n")
        : "(No messages yet)";

    const shareText = `${title}\n\n${transcript}`;

    try {
      if (typeof navigator.share === "function") {
        await navigator.share({
          title,
          text: shareText
        });
        showToast("Chat shared.", "success");
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareText);
        showToast("Chat copied to clipboard.", "success");
      } else {
        throw new Error("Sharing is not supported in this browser.");
      }
      setErrorText("");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      const message = error instanceof Error ? error.message : "Failed to share chat.";
      setErrorText(message);
      showToast(message, "error");
    }
  }

  async function submitChatPrompt(rawPrompt: string) {
    const trimmed = rawPrompt.trim();
    if (!trimmed || isSending || !activeConversationId || submitLockRef.current) {
      return;
    }

    submitLockRef.current = true;
    setErrorText("");
    setIsSending(true);
    setStreamStatus("streaming");
    setTokensEmitted(0);
    setFirstTokenMs(null);

    const conversationId = activeConversationId;
    setConversations((previous) =>
      previous.map((conversation) =>
        conversation.id === conversationId && conversation.archived === true
          ? { ...conversation, archived: false }
          : conversation
      )
    );

    const attachedFilesForMessage = activeFiles.map((fileItem) => ({ ...fileItem }));

    const userMessage: ChatMessage = {
      id: buildId(),
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
      model,
      attachedFiles: attachedFilesForMessage
    };

    const assistantId = buildId();
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      model
    };

    setMessagesByConversation((previous) => ({
      ...previous,
      [conversationId]: [...(previous[conversationId] ?? []), userMessage, assistantMessage]
    }));
    updateConversationSummary(conversationId, trimmed, trimmed);

    setActiveStreamingAssistantId(assistantId);
    setInput("");

    const controller = new AbortController();
    abortControllerRef.current = controller;
    typingQueueRef.current = [];
    typingFinishWhenEmptyRef.current = false;
    typingTargetRef.current = { conversationId, assistantId };
    if (typingTimerRef.current) {
      window.clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }

    let streamedText = "";

    try {
      const authToken = await getToken();
      if (!authToken) {
        throw new Error("Authentication token unavailable. Please sign in again.");
      }

      const result = await streamChat(
        {
          session_id: conversationId,
          message: trimmed,
          model,
          stream: true,
          force_search: forceWebSearch && searchReady
        },
        authToken,
        (chunk: StreamChunk) => {
          if (chunk.type === "token") {
            streamedText += chunk.content;
            setTokensEmitted((value) => value + 1);
            typingTargetRef.current = { conversationId, assistantId };
            typingQueueRef.current.push(...Array.from(chunk.content));
            scheduleTypingFlush();
            return;
          }

          if (chunk.type === "error") {
            setStreamStatus("interrupted");
            setErrorText(chunk.content || "Streaming error received.");
            return;
          }

          setStreamStatus(chunk.status ?? "completed");
          if (chunk.request_id) {
            setRequestId(chunk.request_id);
          }
          if (typeof chunk.response_ms === "number") {
            setResponseMs(chunk.response_ms);
          }
          if (typeof chunk.first_token_ms === "number") {
            setFirstTokenMs(chunk.first_token_ms);
          }
          if (typeof chunk.tokens_emitted === "number") {
            setTokensEmitted(chunk.tokens_emitted);
          }

          setMessagesByConversation((previous) => ({
            ...previous,
            [conversationId]: (previous[conversationId] ?? []).map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    searchUsed: chunk.search_used === true,
                    fileContextUsed: chunk.file_context_used === true,
                    sources: Array.isArray(chunk.sources) ? chunk.sources : []
                  }
                : message
            )
          }));
          finishStreamingDisplay();
        },
        controller.signal
      );

      setRequestId(result.requestId);
      setResponseMs(result.responseMs);
      setFirstTokenMs(result.firstTokenMs);
      setTokensEmitted(result.tokensEmitted);
      setStreamStatus("completed");

      setMessagesByConversation((previous) => ({
        ...previous,
        [conversationId]: (previous[conversationId] ?? []).map((message) =>
          message.id === assistantId
            ? {
                ...message,
                searchUsed: result.searchUsed,
                fileContextUsed: result.fileContextUsed,
                sources: result.sources
              }
            : message
        )
      }));

      updateConversationSummary(conversationId, trimmed, streamedText || trimmed);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Unknown error";
      setStreamStatus("interrupted");
      if (text !== "Generation stopped by user.") {
        setErrorText(text);
      }
      if (streamedText.trim() === "" && typingQueueRef.current.length === 0) {
        typingTargetRef.current = null;
        typingFinishWhenEmptyRef.current = false;
        if (typingTimerRef.current) {
          window.clearTimeout(typingTimerRef.current);
          typingTimerRef.current = null;
        }
        window.setTimeout(() => {
          setMessagesByConversation((previous) => ({
            ...previous,
            [conversationId]: (previous[conversationId] ?? []).filter(
              (message) => !(message.id === assistantId && message.content.trim() === "")
            )
          }));
        }, 0);
        setActiveStreamingAssistantId(null);
      } else {
        finishStreamingDisplay();
      }
      updateConversationSummary(conversationId, trimmed, streamedText || trimmed);
    } finally {
      abortControllerRef.current = null;
      submitLockRef.current = false;
      setIsSending(false);
    }
  }

  async function submitAgentGoal(rawPrompt: string) {
    const trimmed = rawPrompt.trim();
    if (!trimmed || isSending || !activeConversationId || submitLockRef.current) {
      return;
    }

    submitLockRef.current = true;
    setErrorText("");
    setIsSending(true);
    setStreamStatus("planning");

    const conversationId = activeConversationId;
    const attachedFilesForMessage = activeFiles.map((fileItem) => ({ ...fileItem }));
    const userMessage: ChatMessage = {
      id: buildId(),
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
      model,
      attachedFiles: attachedFilesForMessage,
    };
    const assistantId = buildId();
    const placeholderPlan: AgentPlan = {
      plan_id: `pending-${assistantId}`,
      goal: trimmed,
      steps: [],
    };
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      model,
      agentTask: buildAgentTaskState(placeholderPlan),
    };

    setMessagesByConversation((previous) => ({
      ...previous,
      [conversationId]: [...(previous[conversationId] ?? []), userMessage, assistantMessage],
    }));
    updateConversationSummary(conversationId, trimmed, trimmed);
    setInput("");

    try {
      const authToken = await getToken();
      if (!authToken) {
        throw new Error("Authentication token unavailable. Please sign in again.");
      }

      const plan = await createAgentPlan(authToken, trimmed, conversationId);
      updateAgentMessageState(conversationId, assistantId, () => buildAgentTaskState(plan));
      updateConversationSummary(conversationId, trimmed, `Agent plan ready: ${plan.steps.length} steps`);
      setStreamStatus("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create agent plan.";
      setErrorText(message);
      setMessagesByConversation((previous) => ({
        ...previous,
        [conversationId]: (previous[conversationId] ?? []).filter((entry) => entry.id !== assistantId),
      }));
      setStreamStatus("failed");
    } finally {
      submitLockRef.current = false;
      setIsSending(false);
    }
  }

  async function handleRunAgentPlan(messageId: string) {
    if (!activeConversationId || isSending) {
      return;
    }

    const conversationId = activeConversationId;
    const targetMessage = (messagesByConversation[conversationId] ?? []).find((message) => message.id === messageId);
    const agentTask = targetMessage?.agentTask;
    if (!agentTask) {
      return;
    }

    submitLockRef.current = true;
    setIsSending(true);
    setErrorText("");
    setStreamStatus("running");
    setActiveStreamingAssistantId(messageId);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    updateAgentMessageState(conversationId, messageId, (currentTask) => ({
      ...currentTask,
      status: "running",
      error: "",
      warning: "",
      summary: "",
      runningStepNumber: null,
      stepResults: [],
      stepsCompleted: 0,
    }));

    try {
      const authToken = await getToken();
      if (!authToken) {
        throw new Error("Authentication token unavailable. Please sign in again.");
      }

      await runAgent(
        authToken,
        agentTask.plan.plan_id,
        conversationId,
        {
          onPlan: (plan) => {
            updateAgentMessageState(conversationId, messageId, (currentTask) => ({
              ...currentTask,
              plan,
            }));
          },
          onStepStart: ({ step_number }) => {
            updateAgentMessageState(conversationId, messageId, (currentTask) => ({
              ...currentTask,
              status: "running",
              runningStepNumber: step_number,
            }));
          },
          onStepDone: (payload) => {
            updateAgentMessageState(conversationId, messageId, (currentTask) => {
              const stepTemplate = currentTask.plan.steps.find((step) => step.step_number === payload.step_number);
              const nextStepResult: AgentStepResult = {
                step_number: payload.step_number,
                description: stepTemplate?.description ?? "",
                tool: stepTemplate?.tool ?? null,
                tool_input: stepTemplate?.tool_input ?? null,
                result: payload.result,
                status: payload.status,
                error: payload.error ?? null,
              };
              const remainingResults = currentTask.stepResults.filter((entry) => entry.step_number !== payload.step_number);
              return {
                ...currentTask,
                stepResults: [...remainingResults, nextStepResult].sort((left, right) => left.step_number - right.step_number),
                runningStepNumber: null,
              };
            });
          },
          onWarning: (message) => {
            updateAgentMessageState(conversationId, messageId, (currentTask) => ({
              ...currentTask,
              warning: message,
            }));
          },
          onSummaryToken: (token) => {
            updateAgentMessageState(conversationId, messageId, (currentTask) => ({
              ...currentTask,
              summary: `${currentTask.summary}${token}`,
            }));
          },
          onDone: ({ steps_completed, warning }) => {
            updateAgentMessageState(conversationId, messageId, (currentTask) => ({
              ...currentTask,
              status: "completed",
              stepsCompleted: steps_completed,
              warning: warning ?? currentTask.warning,
              runningStepNumber: null,
            }));
          },
          onError: (message) => {
            updateAgentMessageState(conversationId, messageId, (currentTask) => ({
              ...currentTask,
              status: "failed",
              error: message,
              runningStepNumber: null,
            }));
            setErrorText(message);
          },
        },
        controller.signal
      );

      setStreamStatus("completed");
      updateConversationSummary(conversationId, agentTask.plan.goal, "Agent task completed");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Agent run failed.";
      setErrorText(message);
      updateAgentMessageState(conversationId, messageId, (currentTask) => ({
        ...currentTask,
        status: "failed",
        error: message,
        runningStepNumber: null,
      }));
      setStreamStatus("failed");
    } finally {
      abortControllerRef.current = null;
      submitLockRef.current = false;
      setIsSending(false);
      setActiveStreamingAssistantId(null);
    }
  }

  async function submitPrompt(rawPrompt: string) {
    if (isAgentMode) {
      await submitAgentGoal(rawPrompt);
      return;
    }
    await submitChatPrompt(rawPrompt);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitPrompt(input);
  }

  function handleRetryPrompt(prompt: string) {
    if (!isSending) {
      void submitChatPrompt(prompt);
    }
  }

  function handleStopGenerating() {
    abortControllerRef.current?.abort();
  }

  function handleThemeModeChange(nextThemeMode: ThemeMode) {
    setThemeMode(nextThemeMode);
    const themeLabel = nextThemeMode[0].toUpperCase() + nextThemeMode.slice(1);
    showToast(`Theme updated: ${themeLabel}.`, "info");
    setErrorText("");
  }

  function handleOpenUserSettings() {
    const openUserProfile = (clerk as unknown as { openUserProfile?: () => void }).openUserProfile;
    if (typeof openUserProfile === "function") {
      openUserProfile();
      showToast("Opening account settings...", "info");
      return;
    }
    const message = "Account settings are not available in this build.";
    setErrorText(message);
    showToast(message, "error");
  }

  function handleSignOut() {
    void clerk.signOut();
  }

  async function handleOpenFileUpload() {
    if (!activeConversationId) {
      return;
    }

    try {
      const authToken = await getToken();
      if (!authToken) {
        throw new Error("Authentication token unavailable. Please sign in again.");
      }
      setFileModalAuthToken(authToken);
      setIsFileModalOpen(true);
      setErrorText("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to open file upload.";
      setErrorText(message);
      showToast(message, "error");
    }
  }

  async function handleOpenAgentHistory() {
    try {
      const authToken = await getToken();
      if (!authToken) {
        throw new Error("Authentication token unavailable. Please sign in again.");
      }
      setAgentHistoryAuthToken(authToken);
      setIsAgentHistoryOpen(true);
      setErrorText("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to open agent history.";
      setErrorText(message);
      showToast(message, "error");
    }
  }

  const handleUploadedFilesChange = useCallback(
    (files: UploadedFileItem[]) => {
      if (!activeConversationId) {
        return;
      }
      setFilesByConversation((previous) => ({
        ...previous,
        [activeConversationId]: files
      }));
      setFileCountsByConversation((previous) => {
        const currentCount = previous[activeConversationId] ?? 0;
        if (currentCount === files.length) {
          return previous;
        }
        return {
          ...previous,
          [activeConversationId]: files.length,
        };
      });
    },
    [activeConversationId]
  );

  function handleTextareaKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!isSending) {
        void submitPrompt(input);
      }
    }
  }

  return (
    <main className={`nc-shell ${isDiagnosticsOpen ? "nc-shell--with-panel" : ""}`}>
      {toasts.length > 0 ? (
        <div className="nc-toast-stack" aria-live="polite" aria-label="Notifications">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`nc-toast nc-toast--${toast.tone}`}
              role={toast.tone === "error" ? "alert" : "status"}
            >
              <span>{toast.message}</span>
              <button type="button" aria-label="Dismiss notification" onClick={() => removeToast(toast.id)}>
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <Sidebar
        historyItems={historyItems}
        archivedHistoryItems={archivedHistoryItems}
        activeConversationId={activeConversationId}
        isMobileOpen={isSidebarOpen}
        userName={userDisplayName}
        userSubtitle={userSubtitle}
        isWebSearchMode={forceWebSearch}
        isWebSearchAvailable={searchReady}
        isAgentMode={isAgentMode}
        onNewChat={handleNewChat}
        onSelectConversation={handleSelectConversation}
        onToggleArchiveConversation={handleToggleArchiveConversation}
        onDeleteConversation={handleDeleteConversation}
        onShareConversation={handleShareConversation}
        onToggleWebSearchMode={() => {
          if (searchReady) {
            setForceWebSearch((value) => !value);
          }
        }}
        onToggleAgentMode={() => setIsAgentMode((value) => !value)}
        themeMode={themeMode}
        onThemeModeChange={handleThemeModeChange}
        onOpenUserSettings={handleOpenUserSettings}
        onSignOut={handleSignOut}
        onCloseMobile={() => setIsSidebarOpen(false)}
      />

      {isSidebarOpen ? <button className="nc-sidebar-backdrop" onClick={() => setIsSidebarOpen(false)} /> : null}

      <section className="nc-main">
        <header className="nc-topbar">
          <div className="nc-topbar__left">
            <button
              type="button"
              className="nc-mobile-menu"
              aria-label="Open sidebar"
              onClick={() => setIsSidebarOpen(true)}
            >
              <UiIcon kind="menu" className="nc-ui-icon" />
            </button>
            <h1>{activeConversation?.title ?? "New chat"}</h1>
          </div>

          <div className="nc-topbar__right">
            <button
              type="button"
              className="nc-topbar-btn nc-topbar-btn--icon-label"
              aria-label="Open agent history"
              onClick={() => void handleOpenAgentHistory()}
            >
              <UiIcon kind="agent" className="nc-ui-icon" />
              <span>Agents</span>
            </button>
            <button
              type="button"
              className="nc-topbar-btn"
              aria-label="Share chat"
              onClick={() => {
                if (activeConversationId) {
                  void handleShareConversation(activeConversationId);
                }
              }}
            >
              Share
            </button>
            <ModelSelector value={model} onChange={setModel} variant="topbar" />
            <button
              type="button"
              className="nc-topbar-btn"
              aria-label="Toggle diagnostics"
              onClick={() => setIsDiagnosticsOpen((value) => !value)}
            >
              Debug
            </button>
          </div>
        </header>

        <div className="nc-message-area">
          {currentMessages.length === 0 ? (
            <section className="nc-empty-state" data-testid="empty-state">
              <div className="nc-empty-mark">
                <UiIcon kind="brand" className="nc-empty-mark__icon" />
              </div>
              <h2>How can I help you today?</h2>
              <div className="nc-empty-chips">
                {EMPTY_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="nc-empty-chip"
                    onClick={() => {
                      setInput(suggestion);
                      textareaRef.current?.focus();
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <ChatWindow
              messages={currentMessages}
              streamingMessageId={activeStreamingAssistantId}
              onRetryPrompt={handleRetryPrompt}
              onRunAgentPlan={handleRunAgentPlan}
            />
          )}
        </div>

        <footer className="nc-input-wrap">
          <form onSubmit={handleSubmit} className="nc-input-shell">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleTextareaKeyDown}
              placeholder={isAgentMode ? "Describe a goal for the agent..." : "Message NeuralChat..."}
              rows={1}
            />

            <div className="nc-input-row">
              <div className="nc-input-left">
                <button
                  type="button"
                  className="nc-attach-btn"
                  aria-label="Add files to this chat"
                  onClick={() => void handleOpenFileUpload()}
                  title="Add or manage files for this chat"
                >
                  <UiIcon kind="attach" className="nc-ui-icon" />
                  <span>Add files</span>
                </button>
              </div>

              {isSending ? (
                <button type="button" className="nc-send-btn" aria-label="Stop generating" onClick={handleStopGenerating}>
                  <UiIcon kind="stop" className="nc-send-btn__icon" />
                </button>
              ) : (
                <button type="submit" className="nc-send-btn" aria-label="Send message" disabled={!input.trim()}>
                  <UiIcon kind="send" className="nc-send-btn__icon" />
                </button>
              )}
            </div>
          </form>

          {errorText ? <p className="nc-error">{errorText}</p> : null}
          <p className="nc-input-note">NeuralChat can make mistakes. Verify important info.</p>
        </footer>
      </section>

      {isDiagnosticsOpen ? (
        <aside className="nc-right-panel">
          <DebugPanel
            selectedModel={model}
            requestId={requestId}
            responseMs={responseMs}
            firstTokenMs={firstTokenMs}
            tokensEmitted={tokensEmitted}
            streamStatus={streamStatus}
            backendHealthy={backendHealthy}
          />
        </aside>
      ) : null}

      {isFileModalOpen && activeConversationId && fileModalAuthToken ? (
        <FileUpload
          open={isFileModalOpen}
          authToken={fileModalAuthToken}
          sessionId={activeConversationId}
          onFilesChange={handleUploadedFilesChange}
          onClose={() => setIsFileModalOpen(false)}
        />
      ) : null}

      {isAgentHistoryOpen && agentHistoryAuthToken ? (
        <AgentHistory authToken={agentHistoryAuthToken} open={isAgentHistoryOpen} onClose={() => setIsAgentHistoryOpen(false)} />
      ) : null}
    </main>
  );
}

export default function App() {
  return (
    <>
      <SignedOut>
        <main className="nc-auth-shell">
          <div className="nc-auth-grid">
            <section className="nc-auth-brand">
              <div className="nc-auth-brand__top">
                <span className="nc-auth-brand__mark" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="8.3" stroke="currentColor" strokeWidth="1.7" />
                    <path d="M8 12C8 9.8 9.8 8 12 8C14.2 8 16 9.8 16 12C16 14.2 14.2 16 12 16" stroke="currentColor" strokeWidth="1.7" />
                  </svg>
                </span>
                <span className="nc-auth-brand__wordmark">NeuralChat</span>
              </div>

              <h1>NeuralChat</h1>
              <p>Personal AI workspace with streaming answers, optional web search, and your own private chat memory.</p>

              <ul className="nc-auth-brand__list">
                <li>Secure sign-in with Clerk</li>
                <li>GPT-5 streaming responses</li>
                <li>User-scoped chat history and memory</li>
              </ul>
            </section>

            <section className="nc-auth-card">
              <div className="nc-auth-card__head">
                <h2>Welcome back</h2>
                <p>Sign in to continue to NeuralChat.</p>
              </div>
              <div className="nc-auth-clerk-wrap">
                <SignIn appearance={SIGN_IN_APPEARANCE as unknown as never} />
              </div>
            </section>
          </div>
        </main>
      </SignedOut>

      <SignedIn>
        <ChatShell />
      </SignedIn>
    </>
  );
}
