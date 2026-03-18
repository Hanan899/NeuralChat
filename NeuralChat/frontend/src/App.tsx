import { SignIn, SignedIn, SignedOut, useAuth, useClerk, useUser } from "@clerk/clerk-react";
import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { checkHealth, checkSearchStatus, deleteConversationSession, generateConversationTitle, getFiles, getProjectFiles, streamChat } from "./api";
import type { RequestNamingContext } from "./api";
import { createAgentPlan, runAgent } from "./api/agent";
import {
  createProjectChat,
  deleteProject,
  getAllProjects,
  getProject,
  getProjectChatMessages,
  getProjectChats,
  getProjectMemory,
  getTemplates,
  updateProject,
} from "./api/projects";
import { getTodayUsage } from "./api/usage";
import { AgentHistory } from "./components/AgentHistory";
import { ChatWindow } from "./components/ChatWindow";
import { CostWarningBanner } from "./components/CostWarningBanner";
import { FileUpload } from "./components/FileUpload";
import { ModelSelector } from "./components/ModelSelector";
import { SettingsPanel } from "./components/SettingsPanel";
import { Sidebar } from "./components/Sidebar";
import type { ShortcutId } from "./components/Sidebar";
import { ProjectWorkspacePage } from "./pages/ProjectWorkspacePage";
import { ProjectsPage } from "./pages/ProjectsPage";
import type {
  AgentPlan,
  AgentStepResult,
  AgentTaskState,
  ChatMessage,
  ChatModel,
  ConversationSummary,
  DailyLimitSummary,
  StreamChunk,
  ThemeMode,
  UploadedFileItem,
} from "./types";
import type { Project, ProjectChat, ProjectTemplate } from "./types/project";

const EMPTY_SUGGESTIONS = [
  "Summarize this project architecture in simple terms",
  "Help me debug my API latency",
  "Write a clean README section for setup",
  "Give me a step-by-step learning path"
];

const THEME_STORAGE_KEY = "neuralchat:theme-mode:v1";
const COST_WARNING_STORAGE_KEY = "neuralchat:cost-warning:dismissed";
const SIDEBAR_SHORTCUT_LABELS: Record<ShortcutId, string> = {
  new: "New chat",
  images: "Images",
  apps: "Apps",
  research: "Deep research",
  codex: "Codex",
  projects: "Projects",
};
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

// Shared neural network SVG — used in the empty state center icon and the auth brand mark.
// Renders a 3-layer network: 2 input nodes → 3 hidden (purple) → 2 output nodes.
function NeuralNetworkIcon({ className, size = 36 }: { className?: string; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 36 36"
      width={size}
      height={size}
      fill="none"
      className={className}
    >
      {/* Input → Hidden connections */}
      <line x1="5"  y1="9"  x2="16" y2="5"  stroke="currentColor" strokeWidth="1" strokeOpacity="0.50"/>
      <line x1="5"  y1="9"  x2="16" y2="18" stroke="currentColor" strokeWidth="1" strokeOpacity="0.50"/>
      <line x1="5"  y1="9"  x2="16" y2="31" stroke="currentColor" strokeWidth="1" strokeOpacity="0.28"/>
      <line x1="5"  y1="27" x2="16" y2="5"  stroke="currentColor" strokeWidth="1" strokeOpacity="0.28"/>
      <line x1="5"  y1="27" x2="16" y2="18" stroke="currentColor" strokeWidth="1" strokeOpacity="0.50"/>
      <line x1="5"  y1="27" x2="16" y2="31" stroke="currentColor" strokeWidth="1" strokeOpacity="0.50"/>
      {/* Hidden → Output connections */}
      <line x1="16" y1="5"  x2="31" y2="12" stroke="currentColor" strokeWidth="1" strokeOpacity="0.50"/>
      <line x1="16" y1="5"  x2="31" y2="24" stroke="currentColor" strokeWidth="1" strokeOpacity="0.28"/>
      <line x1="16" y1="18" x2="31" y2="12" stroke="currentColor" strokeWidth="1" strokeOpacity="0.60"/>
      <line x1="16" y1="18" x2="31" y2="24" stroke="currentColor" strokeWidth="1" strokeOpacity="0.60"/>
      <line x1="16" y1="31" x2="31" y2="12" stroke="currentColor" strokeWidth="1" strokeOpacity="0.28"/>
      <line x1="16" y1="31" x2="31" y2="24" stroke="currentColor" strokeWidth="1" strokeOpacity="0.50"/>
      {/* Input nodes — muted */}
      <circle cx="5"  cy="9"  r="2.8" fill="currentColor" fillOpacity="0.75"/>
      <circle cx="5"  cy="27" r="2.8" fill="currentColor" fillOpacity="0.75"/>
      {/* Hidden nodes — purple accent */}
      <circle cx="16" cy="5"  r="2.8" fill="#7F77DD"/>
      <circle cx="16" cy="18" r="3.4" fill="#7F77DD"/>
      <circle cx="16" cy="31" r="2.8" fill="#7F77DD"/>
      {/* Output nodes */}
      <circle cx="31" cy="12" r="2.8" fill="currentColor"/>
      <circle cx="31" cy="24" r="2.8" fill="currentColor"/>
    </svg>
  );
}

function UiIcon({
  kind,
  className
}: {
  kind: "brand" | "attach" | "search" | "send" | "stop" | "menu" | "agent";
  className?: string;
}) {
  if (kind === "brand") {
    return <NeuralNetworkIcon className={className} size={36} />;
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

const TITLE_STOP_WORDS = new Set([
  "a", "an", "and", "are", "can", "could", "do", "for", "help", "how",
  "i", "in", "is", "it", "me", "my", "of", "on", "please", "tell",
  "that", "the", "this", "to", "what", "with", "would", "you",
]);

function formatTitleWords(words: string[]): string {
  return words
    .map((word) => {
      if (["ai", "api", "gpt", "pdf", "ui", "ux"].includes(word.toLowerCase())) {
        return word.toUpperCase();
      }
      if (word.length <= 3 && word === word.toUpperCase()) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ")
    .trim();
}

function buildLocalConversationTitle(prompt: string): string {
  const cleanedPrompt = prompt.trim().replace(/\s+/g, " ");
  if (!cleanedPrompt) {
    return "New chat";
  }

  const loweredPrompt = cleanedPrompt.toLowerCase();
  if (loweredPrompt.includes("attached") || loweredPrompt.includes("document") || loweredPrompt.includes("file")) {
    if (loweredPrompt.includes("prd")) {
      return "PRD Document Review";
    }
    return "Document Review";
  }
  if (loweredPrompt.includes("api latency")) {
    return "API Latency Debugging";
  }
  if (loweredPrompt.includes("readme")) {
    return "README Writing";
  }

  const meaningfulWords = cleanedPrompt
    .replace(/^(can you|could you|would you|please|help me|tell me|explain|i want|i need)\s+/i, "")
    .match(/[A-Za-z0-9][A-Za-z0-9.+-]*/g);

  if (!meaningfulWords || meaningfulWords.length === 0) {
    return "New chat";
  }

  const filteredWords = meaningfulWords.filter((word) => !TITLE_STOP_WORDS.has(word.toLowerCase()));
  const selectedWords = (filteredWords.length >= 3 ? filteredWords : meaningfulWords).slice(0, 5);
  return formatTitleWords(selectedWords) || "New chat";
}

function shouldRefineConversationTitle(prompt: string, localTitle: string): boolean {
  const normalizedPrompt = prompt.trim();
  const normalizedTitle = localTitle.trim();
  if (!normalizedPrompt || !normalizedTitle || normalizedTitle === "New chat") {
    return false;
  }
  const titleWordCount = normalizedTitle.split(/\s+/).length;
  return (
    normalizedPrompt.length > 42 ||
    titleWordCount >= 4 ||
    /[?]/.test(normalizedPrompt) ||
    /\b(attached|document|file|summarize|summary|analyze|explain|review|research|debug)\b/i.test(normalizedPrompt)
  );
}

function getUserStorageKey(userId: string) {
  return `neuralchat:workspace-ui:v2:${userId}`;
}

function getCostWarningStorageKey(userId: string, usageDate: string) {
  return `${COST_WARNING_STORAGE_KEY}:${userId}:${usageDate}`;
}

function buildConversationSummary(title = "New chat"): ConversationSummary {
  return {
    id: `c-${crypto.randomUUID()}`,
    title,
    preview: "",
    updatedAt: new Date().toISOString()
  };
}

function buildWorkspaceDescription(shortcutId: Exclude<ShortcutId, "new">): string {
  if (shortcutId === "images") {
    return "Image tools are not wired into NeuralChat yet, but this workspace is reserved for visual creation and image-first prompts.";
  }
  if (shortcutId === "apps") {
    return "Apps will become your launcher for connected tools and purpose-built workflows inside NeuralChat.";
  }
  if (shortcutId === "research") {
    return "Deep research prepares the chat for longer, web-assisted and agent-assisted investigation work.";
  }
  if (shortcutId === "codex") {
    return "Codex switches the workspace into a coding-focused flow so you can plan, debug, and iterate with Agent mode.";
  }
  return "Projects will become the home for longer-running workstreams and grouped conversations.";
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
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [activeShortcutId, setActiveShortcutId] = useState<ShortcutId>("new");
  const [activeWorkspaceShortcut, setActiveWorkspaceShortcut] = useState<Exclude<ShortcutId, "new"> | null>(null);
  const [activeStreamingAssistantId, setActiveStreamingAssistantId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState("");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, ChatMessage[]>>({});
  const [fileCountsByConversation, setFileCountsByConversation] = useState<Record<string, number>>({});
  const [filesByConversation, setFilesByConversation] = useState<Record<string, UploadedFileItem[]>>({});
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [isFileModalOpen, setIsFileModalOpen] = useState(false);
  const [fileModalAuthToken, setFileModalAuthToken] = useState("");
  const [sessionAuthToken, setSessionAuthToken] = useState("");
  const [isAgentHistoryOpen, setIsAgentHistoryOpen] = useState(false);
  const [agentHistoryAuthToken, setAgentHistoryAuthToken] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectTemplates, setProjectTemplates] = useState<Record<string, ProjectTemplate>>({});
  const [isProjectsLoading, setIsProjectsLoading] = useState(false);
  const [projectsErrorText, setProjectsErrorText] = useState("");
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [projectChats, setProjectChats] = useState<ProjectChat[]>([]);
  const [projectMemory, setProjectMemory] = useState<Record<string, unknown>>({});
  const [projectFiles, setProjectFiles] = useState<UploadedFileItem[]>([]);
  const [isProjectWorkspaceLoading, setIsProjectWorkspaceLoading] = useState(false);
  const [todayUsageSummary, setTodayUsageSummary] = useState<DailyLimitSummary | null>(null);
  const [isCostWarningDismissed, setIsCostWarningDismissed] = useState(false);
  const [activeUsageDate, setActiveUsageDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const notifPanelRef = useRef<HTMLDivElement | null>(null);
  const notifBtnRef = useRef<HTMLButtonElement | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const fileModalAuthTokenRef = useRef<string>("");
  const submitLockRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const toastTimersRef = useRef<Record<string, ReturnType<typeof window.setTimeout>>>({});
  const conversationsRef = useRef<ConversationSummary[]>([]);
  const typingQueueRef = useRef<string[]>([]);
  const typingTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const typingTargetRef = useRef<{ conversationId: string; assistantId: string } | null>(null);
  const typingFinishWhenEmptyRef = useRef(false);
  const refiningConversationIdsRef = useRef<Set<string>>(new Set());

  const searchReady = searchEnabled === true;
  const resolvedThemeMode: "dark" | "light" = themeMode === "system" ? systemTheme : themeMode;
  const userDisplayName = resolveDisplayName(user, userId);
  const userSubtitle = resolveUserSubtitle(user);
  const projectRouteMatch = location.pathname.match(/^\/projects\/([^/]+)$/);
  const activeProjectId = projectRouteMatch ? decodeURIComponent(projectRouteMatch[1]) : null;
  const isProjectsIndexRoute = location.pathname === "/projects";
  const activeProjectChatId = activeProjectId ? searchParams.get("chat") : null;
  const isProjectOverviewRoute = Boolean(activeProjectId && !activeProjectChatId);
  const isProjectChatRoute = Boolean(activeProjectId && activeProjectChatId);
  const activeSessionId = isProjectChatRoute ? (activeProjectChatId ?? "") : activeConversationId;
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

  const currentMessages = activeSessionId ? messagesByConversation[activeSessionId] ?? [] : [];
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId) ?? null;
  const activeFiles = isProjectOverviewRoute || isProjectChatRoute ? projectFiles : (activeConversationId ? filesByConversation[activeConversationId] ?? [] : []);
  const activeRequestNaming = useMemo<RequestNamingContext>(
    () => ({
      userDisplayName,
      sessionTitle: isProjectOverviewRoute || isProjectChatRoute
        ? activeProject?.name?.trim() || "Project chat"
        : activeConversation?.title?.trim() || "New chat",
    }),
    [activeConversation?.title, activeProject?.name, isProjectChatRoute, isProjectOverviewRoute, userDisplayName]
  );
  useEffect(() => {
    checkHealth().then(setBackendHealthy).catch(() => setBackendHealthy(false));
    checkSearchStatus()
      .then((status) => setSearchEnabled(status))
      .catch(() => setSearchEnabled(false));
  }, []);

  useEffect(() => {
    getTemplates()
      .then(setProjectTemplates)
      .catch(() => setProjectTemplates({}));
  }, []);

  useEffect(() => {
    if (!userId) {
      setSessionAuthToken("");
      return;
    }
    let cancelled = false;
    async function loadSessionToken() {
      const authToken = await getToken();
      if (!cancelled && authToken) {
        setSessionAuthToken(authToken);
      }
    }
    void loadSessionToken();
    return () => {
      cancelled = true;
    };
  }, [getToken, userId]);

  useEffect(() => {
    if (isProjectsIndexRoute || isProjectOverviewRoute || isProjectChatRoute) {
      setActiveShortcutId("projects");
      setActiveWorkspaceShortcut(null);
    }
  }, [isProjectChatRoute, isProjectOverviewRoute, isProjectsIndexRoute]);

  const refreshProjects = useCallback(async () => {
    if (!userId) {
      setProjects([]);
      return;
    }

    try {
      setIsProjectsLoading(true);
      setProjectsErrorText("");
      const authToken = await getToken();
      if (!authToken) {
        return;
      }
      const nextProjects = await getAllProjects(authToken, { userDisplayName });
      setProjects(nextProjects);
    } catch (error) {
      setProjectsErrorText(error instanceof Error ? error.message : "Failed to load projects.");
    } finally {
      setIsProjectsLoading(false);
    }
  }, [getToken, userDisplayName, userId]);

  const refreshActiveProjectWorkspace = useCallback(async () => {
    if (!userId || !activeProjectId) {
      setActiveProject(null);
      setProjectChats([]);
      setProjectMemory({});
      setProjectFiles([]);
      return;
    }

    try {
      setIsProjectWorkspaceLoading(true);
      const authToken = await getToken();
      if (!authToken) {
        return;
      }
      const [projectData, nextProjectChats, nextProjectMemory, nextProjectFiles] = await Promise.all([
        getProject(authToken, activeProjectId, { userDisplayName }),
        getProjectChats(authToken, activeProjectId, { userDisplayName }),
        getProjectMemory(authToken, activeProjectId, { userDisplayName }),
        getProjectFiles(authToken, activeProjectId, { userDisplayName }),
      ]);
      setActiveProject(projectData);
      setProjectChats(nextProjectChats);
      setProjectMemory(nextProjectMemory);
      setProjectFiles(nextProjectFiles.files);
    } catch (error) {
      setProjectsErrorText(error instanceof Error ? error.message : "Failed to load project workspace.");
    } finally {
      setIsProjectWorkspaceLoading(false);
    }
  }, [activeProjectId, getToken, userDisplayName, userId]);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    void refreshActiveProjectWorkspace();
  }, [refreshActiveProjectWorkspace]);

  useEffect(() => {
    if (!activeProjectId || !activeProjectChatId || !userId) {
      return;
    }

    const projectId = activeProjectId;
    const projectChatId = activeProjectChatId;

    let cancelled = false;
    async function loadProjectChat() {
      try {
        const authToken = await getToken();
        if (!authToken) {
          return;
        }
        const messages = await getProjectChatMessages(authToken, projectId, projectChatId, {
          userDisplayName,
          sessionTitle: activeProject?.name || "Project chat",
        });
        if (!cancelled) {
          setMessagesByConversation((previous) => ({
            ...previous,
            [projectChatId]: messages.map((message, index) => ({
              ...message,
              id: message.id || `project-${projectChatId}-${index}`,
              createdAt: message.createdAt || (message as unknown as Record<string, string>).created_at || new Date().toISOString(),
              projectId,
            })),
          }));
        }
      } catch {
        if (!cancelled) {
          setMessagesByConversation((previous) => ({ ...previous, [projectChatId]: [] }));
        }
      }
    }

    void loadProjectChat();
    return () => {
      cancelled = true;
    };
  }, [activeProject?.name, activeProjectChatId, activeProjectId, getToken, userDisplayName, userId]);

  const loadTodayUsageSummary = useCallback(async () => {
    if (!userId) {
      setTodayUsageSummary(null);
      return;
    }

    try {
      setActiveUsageDate(new Date().toISOString().slice(0, 10));
      const authToken = await getToken();
      if (!authToken) {
        return;
      }
      const payload = await getTodayUsage(authToken, {
        userDisplayName,
        sessionTitle: activeConversation?.title?.trim() || "New chat",
      });
      setTodayUsageSummary(payload.summary);
    } catch {
      // Leave the warning hidden when usage cannot be loaded.
    }
  }, [activeConversation?.title, getToken, userDisplayName, userId]);

  useEffect(() => {
    void loadTodayUsageSummary();
    const intervalId = window.setInterval(() => {
      void loadTodayUsageSummary();
    }, 60_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadTodayUsageSummary]);

  useEffect(() => {
    if (!userId) {
      setIsCostWarningDismissed(false);
      return;
    }

    const storageKey = getCostWarningStorageKey(userId, activeUsageDate);
    setIsCostWarningDismissed(window.localStorage.getItem(storageKey) === "1");
  }, [activeUsageDate, userId]);

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
    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Element;
      if (
        notifPanelRef.current &&
        !notifPanelRef.current.contains(target) &&
        notifBtnRef.current &&
        !notifBtnRef.current.contains(target)
      ) {
        setIsNotifOpen(false);
      }
    }
    if (isNotifOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [isNotifOpen]);

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
    if (!activeConversationId || !userId || isProjectOverviewRoute || isProjectChatRoute) {
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

        const payload = await getFiles(authToken, activeConversationId, activeRequestNaming);
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
  }, [activeConversationId, userId, getToken, filesByConversation, activeRequestNaming, isProjectChatRoute, isProjectOverviewRoute]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  function updateConversationSummary(conversationId: string, prompt: string, replyPreview: string) {
    const localTitle = buildLocalConversationTitle(prompt);
    setConversations((previous) =>
      previous.map((conversation) => {
        if (conversation.id !== conversationId) {
          return conversation;
        }

        return {
          ...conversation,
          title: conversation.title === "New chat" ? localTitle : conversation.title,
          preview: replyPreview || prompt,
          updatedAt: new Date().toISOString()
        };
      })
    );
  }

  const refineConversationTitle = useCallback(
    async (conversationId: string, prompt: string, reply: string) => {
      const localTitle = buildLocalConversationTitle(prompt);
      if (!shouldRefineConversationTitle(prompt, localTitle)) {
        return;
      }
      if (refiningConversationIdsRef.current.has(conversationId)) {
        return;
      }

      const conversation = conversationsRef.current.find((item) => item.id === conversationId);
      if (!conversation || conversation.title !== localTitle) {
        return;
      }

      refiningConversationIdsRef.current.add(conversationId);
      try {
        const authToken = await getToken();
        if (!authToken) {
          return;
        }
        const response = await generateConversationTitle(authToken, prompt, reply, {
          userDisplayName,
          sessionTitle: localTitle,
        });
        const refinedTitle = response.title.trim();
        if (!refinedTitle || refinedTitle === localTitle) {
          return;
        }
        setConversations((previous) =>
          previous.map((item) =>
            item.id === conversationId && item.title === localTitle
              ? { ...item, title: refinedTitle, updatedAt: item.updatedAt }
              : item
          )
        );
      } catch {
        // Keep the local title when refinement fails.
      } finally {
        refiningConversationIdsRef.current.delete(conversationId);
      }
    },
    [getToken, userDisplayName]
  );

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
    if (location.pathname !== "/") {
      navigate("/");
    }
    const next = buildConversationSummary();
    setConversations((previous) => [next, ...previous]);
    setMessagesByConversation((previous) => ({ ...previous, [next.id]: [] }));
    setFilesByConversation((previous) => ({ ...previous, [next.id]: [] }));
    setFileCountsByConversation((previous) => ({ ...previous, [next.id]: 0 }));
    setActiveConversationId(next.id);
    setActiveShortcutId("new");
    setActiveWorkspaceShortcut(null);
    setIsSettingsOpen(false);
    setInput("");
    setErrorText("");
    setIsSidebarOpen(false);
  }

  function handleSelectConversation(conversationId: string) {
    if (isSending) {
      return;
    }
    if (location.pathname !== "/") {
      navigate("/");
    }
    setActiveConversationId(conversationId);
    setActiveShortcutId(isAgentMode ? "codex" : "new");
    setActiveWorkspaceShortcut(null);
    setIsSettingsOpen(false);
    setErrorText("");
  }

  function handleOpenImages() {
    navigate("/");
    setActiveShortcutId("images");
    setActiveWorkspaceShortcut("images");
    setIsSettingsOpen(false);
    setErrorText("");
  }

  function handleOpenApps() {
    navigate("/");
    setActiveShortcutId("apps");
    setActiveWorkspaceShortcut("apps");
    setIsSettingsOpen(false);
    setErrorText("");
  }

  function handleOpenResearch() {
    navigate("/");
    setActiveShortcutId("research");
    setActiveWorkspaceShortcut("research");
    setIsSettingsOpen(false);
    setErrorText("");
    if (searchReady) {
      setForceWebSearch(true);
    }
    setIsAgentMode(true);
  }

  function handleOpenCodex() {
    navigate("/");
    setActiveShortcutId("codex");
    setActiveWorkspaceShortcut("codex");
    setIsSettingsOpen(false);
    setErrorText("");
    setIsAgentMode(true);
  }

  function handleOpenProjects() {
    setActiveShortcutId("projects");
    setActiveWorkspaceShortcut(null);
    setIsSettingsOpen(false);
    setErrorText("");
    navigate("/projects");
  }

  function handleOpenProject(projectId: string, sessionId?: string) {
    setActiveShortcutId("projects");
    setActiveWorkspaceShortcut(null);
    setIsSettingsOpen(false);
    setErrorText("");
    navigate(sessionId ? `/projects/${encodeURIComponent(projectId)}?chat=${encodeURIComponent(sessionId)}` : `/projects/${encodeURIComponent(projectId)}`);
  }

  async function handleCreateProjectChat() {
    if (!activeProjectId) {
      return;
    }
    try {
      const authToken = await getToken();
      if (!authToken) {
        throw new Error("Authentication token unavailable. Please sign in again.");
      }
      const response = await createProjectChat(authToken, activeProjectId, { userDisplayName });
      await refreshActiveProjectWorkspace();
      handleOpenProject(activeProjectId, response.session_id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create project chat.";
      setErrorText(message);
      showToast(message, "error");
    }
  }

  async function handleToggleProjectPin() {
    if (!activeProject) {
      return;
    }
    try {
      const authToken = await getToken();
      if (!authToken) {
        throw new Error("Authentication token unavailable. Please sign in again.");
      }
      const updatedProject = await updateProject(
        authToken,
        activeProject.project_id,
        { pinned: !activeProject.pinned },
        { userDisplayName, sessionTitle: activeProject.name }
      );
      setActiveProject(updatedProject);
      await refreshProjects();
      await refreshActiveProjectWorkspace();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update project.";
      setErrorText(message);
      showToast(message, "error");
    }
  }

  async function handleDeleteActiveProject() {
    if (!activeProject) {
      return;
    }
    const confirmed = window.confirm(`Delete project "${activeProject.name}"? This removes project chats, memory, and files.`);
    if (!confirmed) {
      return;
    }
    try {
      const authToken = await getToken();
      if (!authToken) {
        throw new Error("Authentication token unavailable. Please sign in again.");
      }
      await deleteProject(authToken, activeProject.project_id, { userDisplayName, sessionTitle: activeProject.name });
      await refreshProjects();
      navigate("/projects");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete project.";
      setErrorText(message);
      showToast(message, "error");
    }
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

  function removeConversationLocally(conversationId: string) {
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
        setFilesByConversation((previousFiles) => ({
          ...Object.fromEntries(
            Object.entries(previousFiles).filter(([existingConversationId]) => existingConversationId !== conversationId)
          ),
          [createdConversation.id]: []
        }));
        setFileCountsByConversation((previousCounts) => ({
          ...Object.fromEntries(
            Object.entries(previousCounts).filter(([existingConversationId]) => existingConversationId !== conversationId)
          ),
          [createdConversation.id]: 0
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

    setFilesByConversation((previous) => {
      const next = { ...previous };
      delete next[conversationId];
      return next;
    });
    setFileCountsByConversation((previous) => {
      const next = { ...previous };
      delete next[conversationId];
      return next;
    });
  }

  async function handleDeleteConversation(conversationId: string) {
    if (isSending) {
      return;
    }

    const conversation = conversations.find((item) => item.id === conversationId);
    const naming = {
      userDisplayName,
      sessionTitle: conversation?.title?.trim() || "New chat",
    };

    try {
      const authToken = await getToken();
      if (!authToken) {
        throw new Error("Authentication token unavailable. Please sign in again.");
      }

      await deleteConversationSession(authToken, conversationId, naming);
      removeConversationLocally(conversationId);
      showToast("Chat deleted everywhere.", "success");
      setErrorText("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete chat.";
      setErrorText(message);
      showToast(message, "error");
    }
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
        await navigator.share({ title, text: shareText });
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
    if (!trimmed || isSending || !activeSessionId || submitLockRef.current) {
      return;
    }

    submitLockRef.current = true;
    setErrorText("");
    setIsSending(true);
    setStreamStatus("streaming");
    setTokensEmitted(0);
    setFirstTokenMs(null);

    const conversationId = activeSessionId;
    const requestSessionTitle = isProjectChatRoute
      ? activeProject?.name?.trim() || buildLocalConversationTitle(trimmed)
      : activeConversation?.title === "New chat" || !activeConversation?.title
      ? buildLocalConversationTitle(trimmed)
      : activeConversation.title;
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
      projectId: activeProjectId ?? undefined,
      attachedFiles: attachedFilesForMessage
    };

    const assistantId = buildId();
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      model,
      projectId: activeProjectId ?? undefined,
    };

    setMessagesByConversation((previous) => ({
      ...previous,
      [conversationId]: [...(previous[conversationId] ?? []), userMessage, assistantMessage]
    }));
    if (!isProjectChatRoute) {
      updateConversationSummary(conversationId, trimmed, trimmed);
    }

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
          force_search: forceWebSearch && searchReady,
          project_id: activeProjectId ?? undefined,
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
          if (chunk.request_id) setRequestId(chunk.request_id);
          if (typeof chunk.response_ms === "number") setResponseMs(chunk.response_ms);
          if (typeof chunk.first_token_ms === "number") setFirstTokenMs(chunk.first_token_ms);
          if (typeof chunk.tokens_emitted === "number") setTokensEmitted(chunk.tokens_emitted);

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
        controller.signal,
        { userDisplayName, sessionTitle: requestSessionTitle }
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
            ? { ...message, searchUsed: result.searchUsed, fileContextUsed: result.fileContextUsed, sources: result.sources }
            : message
        )
      }));

      if (!isProjectChatRoute) {
        updateConversationSummary(conversationId, trimmed, streamedText || trimmed);
      }
      if (!isProjectChatRoute && streamedText.trim()) {
        void refineConversationTitle(conversationId, trimmed, streamedText);
      }
      if (isProjectChatRoute) {
        void refreshActiveProjectWorkspace();
      }
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
      if (!isProjectChatRoute) {
        updateConversationSummary(conversationId, trimmed, streamedText || trimmed);
      }
    } finally {
      abortControllerRef.current = null;
      submitLockRef.current = false;
      setIsSending(false);
    }
  }

  async function submitAgentGoal(rawPrompt: string) {
    const trimmed = rawPrompt.trim();
    if (!trimmed || isSending || !activeSessionId || submitLockRef.current) {
      return;
    }

    submitLockRef.current = true;
    setErrorText("");
    setIsSending(true);
    setStreamStatus("planning");

    const conversationId = activeSessionId;
    const requestSessionTitle = isProjectChatRoute
      ? activeProject?.name?.trim() || buildLocalConversationTitle(trimmed)
      : activeConversation?.title === "New chat" || !activeConversation?.title
      ? buildLocalConversationTitle(trimmed)
      : activeConversation.title;
    const attachedFilesForMessage = activeFiles.map((fileItem) => ({ ...fileItem }));
    const userMessage: ChatMessage = {
      id: buildId(),
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
      model,
      projectId: activeProjectId ?? undefined,
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
      projectId: activeProjectId ?? undefined,
      agentTask: buildAgentTaskState(placeholderPlan),
    };

    setMessagesByConversation((previous) => ({
      ...previous,
      [conversationId]: [...(previous[conversationId] ?? []), userMessage, assistantMessage],
    }));
    if (!isProjectChatRoute) {
      updateConversationSummary(conversationId, trimmed, trimmed);
    }
    setInput("");

    try {
      const authToken = await getToken();
      if (!authToken) {
        throw new Error("Authentication token unavailable. Please sign in again.");
      }

      const plan = await createAgentPlan(authToken, trimmed, conversationId, {
        userDisplayName,
        sessionTitle: requestSessionTitle,
      });
      updateAgentMessageState(conversationId, assistantId, () => buildAgentTaskState(plan));
      if (!isProjectChatRoute) {
        updateConversationSummary(conversationId, trimmed, `Agent plan ready: ${plan.steps.length} steps`);
        void refineConversationTitle(conversationId, trimmed, plan.steps.map((step) => step.description).join("; "));
      } else {
        void refreshActiveProjectWorkspace();
      }
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
    if (!activeSessionId || isSending) {
      return;
    }

    const conversationId = activeSessionId;
    const requestSessionTitle = isProjectChatRoute
      ? activeProject?.name?.trim() || "Project chat"
      : activeConversation?.title?.trim() || "New chat";
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
            updateAgentMessageState(conversationId, messageId, (currentTask) => ({ ...currentTask, plan }));
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
            updateAgentMessageState(conversationId, messageId, (currentTask) => ({ ...currentTask, warning: message }));
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
        controller.signal,
        { userDisplayName, sessionTitle: requestSessionTitle }
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

  function handleToggleSidebarPane() {
    if (window.matchMedia("(max-width: 1024px)").matches) {
      setIsSidebarOpen((previous) => !previous);
      return;
    }

    setIsSidebarCollapsed((previous) => !previous);
  }

  function handleThemeModeChange(nextThemeMode: ThemeMode) {
    setThemeMode(nextThemeMode);
    const themeLabel = nextThemeMode[0].toUpperCase() + nextThemeMode.slice(1);
    showToast(`Theme updated: ${themeLabel}.`, "info");
    setErrorText("");
  }

  function handleOpenSettings() {
    setIsSettingsOpen(true);
    setActiveWorkspaceShortcut(null);
    setIsSidebarOpen(false);
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

  function handleDismissCostWarning() {
    if (!userId) {
      setIsCostWarningDismissed(true);
      return;
    }
    const storageKey = getCostWarningStorageKey(userId, activeUsageDate);
    window.localStorage.setItem(storageKey, "1");
    setIsCostWarningDismissed(true);
  }

  async function handleOpenFileUpload() {
    if (!activeSessionId && !activeProjectId) {
      showToast("Start a chat first before adding files.", "info");
      return;
    }

    try {
      let authToken = await getToken();

      if (!authToken) {
        await new Promise<void>((resolve) => setTimeout(resolve, 400));
        authToken = await getToken();
      }

      if (!authToken) {
        throw new Error("Authentication token unavailable. Please sign in again.");
      }

      // Store in ref so it's synchronously available when modal renders
      fileModalAuthTokenRef.current = authToken;
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
      if (isProjectOverviewRoute || isProjectChatRoute) {
        setProjectFiles(files);
        return;
      }
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
        return { ...previous, [activeConversationId]: files.length };
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
    <main
      className={`nc-shell ${isDiagnosticsOpen ? "nc-shell--with-panel" : ""} ${isSidebarCollapsed ? "nc-shell--sidebar-collapsed" : ""}`}
    >


      <Sidebar
        historyItems={historyItems}
        archivedHistoryItems={archivedHistoryItems}
        activeConversationId={activeConversationId}
        isMobileOpen={isSidebarOpen}
        isCollapsed={isSidebarCollapsed}
        projects={projects}
        activeProjectId={activeProjectId ?? undefined}
        userName={userDisplayName}
        userSubtitle={userSubtitle}
        isWebSearchMode={forceWebSearch}
        isWebSearchAvailable={searchReady}
        isAgentMode={isAgentMode}
        activeShortcutId={activeShortcutId}
        onNewChat={handleNewChat}
        onSelectConversation={handleSelectConversation}
        onToggleArchiveConversation={handleToggleArchiveConversation}
        onDeleteConversation={handleDeleteConversation}
        onShareConversation={handleShareConversation}
        onToggleWebSearchMode={() => {
          if (searchReady) {
            setActiveShortcutId("new");
            setForceWebSearch((value) => !value);
          }
        }}
        onToggleAgentMode={() =>
          setIsAgentMode((value) => {
            const nextValue = !value;
            setActiveShortcutId(nextValue ? "codex" : "new");
            return nextValue;
          })
        }
        themeMode={themeMode}
        onThemeModeChange={handleThemeModeChange}
        onOpenSettings={handleOpenSettings}
        onOpenUserSettings={handleOpenUserSettings}
        onSignOut={handleSignOut}
        onCloseMobile={() => setIsSidebarOpen(false)}
        onToggleCollapse={handleToggleSidebarPane}
        onOpenImages={handleOpenImages}
        onOpenApps={handleOpenApps}
        onOpenResearch={handleOpenResearch}
        onOpenCodex={handleOpenCodex}
        onOpenProjects={handleOpenProjects}
        onOpenProject={handleOpenProject}
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
            <h1>
              {isSettingsOpen
                ? "Settings"
                : isProjectChatRoute
                  ? activeProject?.name ?? "Project chat"
                  : isProjectOverviewRoute
                    ? activeProject?.name ?? "Project"
                    : isProjectsIndexRoute
                      ? "Projects"
                : activeWorkspaceShortcut
                  ? SIDEBAR_SHORTCUT_LABELS[activeWorkspaceShortcut]
                  : activeConversation?.title ?? "New chat"}
            </h1>
          </div>

          <div className="nc-topbar__right">
            {isSettingsOpen ? (
              <button
                type="button"
                className="nc-topbar-btn nc-topbar-btn--share"
                aria-label="Close settings"
                onClick={() => setIsSettingsOpen(false)}
              >
                Done
              </button>
            ) : (
              <>
            {/* Agents — icon + label, purple-tinted */}
            <button
              type="button"
              className="nc-topbar-btn nc-topbar-btn--icon-label"
              aria-label="Open agent history"
              onClick={() => void handleOpenAgentHistory()}
            >
              <UiIcon kind="agent" className="nc-ui-icon" />
              <span>Agents</span>
            </button>

            {/* Share — clean pill */}
            <button
              type="button"
              className="nc-topbar-btn nc-topbar-btn--share"
              aria-label="Share chat"
              onClick={() => {
                if (activeConversationId) {
                  void handleShareConversation(activeConversationId);
                }
              }}
            >
              Share
            </button>

            {/* Model selector */}
            <ModelSelector value={model} onChange={setModel} variant="topbar" />

            {/* Notification bell */}
            <div className="nc-notif-wrap">
              <button
                ref={notifBtnRef}
                type="button"
                className={`nc-notif-btn ${isNotifOpen ? "nc-notif-btn--open" : ""}`}
                aria-label="Notifications"
                aria-expanded={isNotifOpen}
                onClick={() => setIsNotifOpen((v) => !v)}
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="nc-notif-icon">
                  <path d="M18 8.5C18 5.46 15.54 3 12.5 3S7 5.46 7 8.5c0 4.63-2 6-2 6h15s-2-1.37-2-6Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/>
                  <path d="M14.17 19a2 2 0 0 1-3.34 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
                </svg>
                {toasts.length > 0 ? (
                  <span className="nc-notif-badge">{toasts.length > 9 ? "9+" : toasts.length}</span>
                ) : null}
              </button>

              {isNotifOpen ? (
                <div ref={notifPanelRef} className="nc-notif-panel" role="region" aria-label="Notifications">
                  <div className="nc-notif-panel__header">
                    <span className="nc-notif-panel__title">Notifications</span>
                    {toasts.length > 0 ? (
                      <button
                        type="button"
                        className="nc-notif-panel__clear"
                        onClick={() => {
                          toasts.forEach((t) => removeToast(t.id));
                        }}
                      >
                        Clear all
                      </button>
                    ) : null}
                  </div>

                  {toasts.length === 0 ? (
                    <div className="nc-notif-empty">
                      <svg viewBox="0 0 24 24" fill="none" className="nc-notif-empty__icon">
                        <path d="M18 8.5C18 5.46 15.54 3 12.5 3S7 5.46 7 8.5c0 4.63-2 6-2 6h15s-2-1.37-2-6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                        <path d="M14.17 19a2 2 0 0 1-3.34 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                      <p>No notifications</p>
                    </div>
                  ) : (
                    <ul className="nc-notif-list">
                      {[...toasts].reverse().map((toast) => (
                        <li key={toast.id} className={`nc-notif-item nc-notif-item--${toast.tone}`}>
                          <span className="nc-notif-item__dot" />
                          <span className="nc-notif-item__msg">{toast.message}</span>
                          <button
                            type="button"
                            className="nc-notif-item__dismiss"
                            aria-label="Dismiss"
                            onClick={() => removeToast(toast.id)}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>
              </>
            )}
          </div>
        </header>

        <div className={`nc-message-area ${isSettingsOpen ? "nc-message-area--settings" : ""}`}>
          {!isSettingsOpen && todayUsageSummary && !isCostWarningDismissed ? (
            <CostWarningBanner summary={todayUsageSummary} onDismiss={handleDismissCostWarning} />
          ) : null}

          {isSettingsOpen ? (
            <SettingsPanel
              getAuthToken={getToken}
              naming={activeRequestNaming}
              onShowToast={showToast}
              onUsageStateChange={setTodayUsageSummary}
              onOpenAccountSettings={handleOpenUserSettings}
            />
          ) : isProjectsIndexRoute ? (
            <ProjectsPage
              authToken={sessionAuthToken}
              naming={{ userDisplayName }}
              projects={projects}
              templates={projectTemplates}
              isLoading={isProjectsLoading}
              errorText={projectsErrorText}
              onRefresh={refreshProjects}
              onOpenProject={handleOpenProject}
            />
          ) : isProjectOverviewRoute && activeProject ? (
            <ProjectWorkspacePage
              authToken={sessionAuthToken}
              project={activeProject}
              templates={projectTemplates}
              chats={projectChats}
              memory={projectMemory}
              files={projectFiles}
              naming={{ userDisplayName, sessionTitle: activeProject.name }}
              onBack={() => navigate("/projects")}
              onOpenChat={(sessionId) => handleOpenProject(activeProject.project_id, sessionId)}
              onCreateChat={() => void handleCreateProjectChat()}
              onRefresh={refreshActiveProjectWorkspace}
              onProjectUpdated={(project) => {
                setActiveProject(project);
                void refreshProjects();
                void refreshActiveProjectWorkspace();
              }}
              onDeleteProject={() => void handleDeleteActiveProject()}
              onTogglePin={() => void handleToggleProjectPin()}
              onUploadFile={() => void handleOpenFileUpload()}
            />
          ) : isProjectOverviewRoute ? (
            <section className="nc-workspace-view">
              <div className="nc-workspace-view__card">
                <p className="nc-workspace-view__eyebrow">Projects</p>
                <h2>{isProjectWorkspaceLoading ? "Loading project…" : "Project not found"}</h2>
                <p className="nc-workspace-view__description">
                  {isProjectWorkspaceLoading ? "Loading project workspace." : "We couldn't find that project."}
                </p>
                <div className="nc-workspace-view__actions">
                  <button type="button" className="nc-empty-chip" onClick={() => navigate("/projects")}>
                    Back to projects
                  </button>
                </div>
              </div>
            </section>
          ) : isProjectChatRoute ? (
            currentMessages.length === 0 && isProjectWorkspaceLoading ? (
              <section className="nc-workspace-view">
                <div className="nc-workspace-view__card">
                  <p className="nc-workspace-view__eyebrow">Projects</p>
                  <h2>Loading chat…</h2>
                </div>
              </section>
            ) : (
              <ChatWindow
                messages={currentMessages}
                streamingMessageId={activeStreamingAssistantId}
                onRetryPrompt={handleRetryPrompt}
                onRunAgentPlan={handleRunAgentPlan}
              />
            )
          ) : activeWorkspaceShortcut ? (
            <section className="nc-workspace-view" data-testid={`workspace-${activeWorkspaceShortcut}`}>
              <div className="nc-workspace-view__card">
                <div className="nc-workspace-view__mark" aria-hidden="true">
                  {activeWorkspaceShortcut === "research" ? (
                    <UiIcon kind="search" className="nc-workspace-view__icon" />
                  ) : activeWorkspaceShortcut === "codex" ? (
                    <UiIcon kind="agent" className="nc-workspace-view__icon" />
                  ) : (
                    <UiIcon kind="brand" className="nc-workspace-view__icon" />
                  )}
                </div>
                <p className="nc-workspace-view__eyebrow">Workspace</p>
                <h2>{SIDEBAR_SHORTCUT_LABELS[activeWorkspaceShortcut]}</h2>
                <p className="nc-workspace-view__description">
                  {buildWorkspaceDescription(activeWorkspaceShortcut)}
                </p>

                <div className="nc-workspace-view__actions">
                  <button
                    type="button"
                    className="nc-empty-chip"
                    onClick={() => {
                      setActiveWorkspaceShortcut(null);
                      textareaRef.current?.focus();
                    }}
                  >
                    Open current chat
                  </button>
                  <button
                    type="button"
                    className="nc-empty-chip"
                    onClick={handleNewChat}
                  >
                    Start new chat
                  </button>
                </div>

                {(activeWorkspaceShortcut === "research" || activeWorkspaceShortcut === "codex") ? (
                  <p className="nc-workspace-view__hint">
                    {activeWorkspaceShortcut === "research"
                      ? searchReady
                        ? "Deep research has turned on Web search and Agent mode for this chat."
                        : "Deep research has turned on Agent mode. Web search is currently unavailable."
                      : "Codex has turned on Agent mode for this chat."}
                  </p>
                ) : (
                  <p className="nc-workspace-view__hint">This section is ready for its dedicated experience next.</p>
                )}
              </div>
            </section>
          ) : currentMessages.length === 0 ? (
            <section className="nc-empty-state" data-testid="empty-state">
              {/* Neural network logo replaces the old circle/arc brand mark */}
              <div className="nc-empty-mark">
                <NeuralNetworkIcon className="nc-empty-mark__icon" size={48} />
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

        {!isSettingsOpen && !isProjectsIndexRoute && !isProjectOverviewRoute ? (
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
        ) : null}
      </section>


      {isFileModalOpen && (activeSessionId || activeProjectId) ? (
        <FileUpload
          open={isFileModalOpen}
          authToken={fileModalAuthToken || fileModalAuthTokenRef.current}
          sessionId={isProjectOverviewRoute || isProjectChatRoute ? undefined : activeConversationId}
          projectId={activeProjectId ?? undefined}
          naming={activeRequestNaming}
          onFilesChange={handleUploadedFilesChange}
          onClose={() => {
            setIsFileModalOpen(false);
            setFileModalAuthToken("");
            fileModalAuthTokenRef.current = "";
          }}
        />
      ) : null}

      {isAgentHistoryOpen && agentHistoryAuthToken ? (
        <AgentHistory
          authToken={agentHistoryAuthToken}
          open={isAgentHistoryOpen}
          naming={activeRequestNaming}
          onClose={() => setIsAgentHistoryOpen(false)}
        />
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
                {/* Neural network logo replaces the old circle/arc mark on the auth page */}
                <span className="nc-auth-brand__mark" aria-hidden="true">
                  <NeuralNetworkIcon size={48} />
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
