import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import { RoleBadge } from "@/components/auth/RoleGate";
import useRBAC from "@/hooks/useRBAC";

import type { ConversationSummary, ThemeMode } from "../types";
import type { Project } from "../types/project";

interface SidebarProps {
  historyItems: ConversationSummary[];
  archivedHistoryItems: ConversationSummary[];
  activeConversationId: string;
  isMobileOpen: boolean;
  isCollapsed?: boolean;
  projects?: Project[];
  activeProjectId?: string;
  userName: string;
  userSubtitle: string;
  themeMode: ThemeMode;
  isWebSearchMode: boolean;
  isWebSearchAvailable: boolean;
  isAgentMode: boolean;
  activeShortcutId?: ShortcutId;
  onNewChat: () => void;
  onSelectConversation: (conversationId: string) => void;
  onToggleArchiveConversation: (conversationId: string) => void;
  onDeleteConversation: (conversationId: string) => void;
  onShareConversation: (conversationId: string) => void;
  onToggleWebSearchMode: () => void;
  onToggleAgentMode: () => void;
  onThemeModeChange: (mode: ThemeMode) => void;
  onOpenSettings: () => void;
  onOpenUserSettings: () => void;
  onSignOut: () => void;
  onCloseMobile: () => void;
  onToggleCollapse: () => void;
  // Optional shortcut handlers
  onOpenImages?: () => void;
  onOpenApps?: () => void;
  onOpenResearch?: () => void;
  onOpenCodex?: () => void;
  onOpenProjects?: () => void;
  onCreateProject?: () => void;
  onOpenProject?: (projectId: string) => void;
  onOpenSettingsSection?: (section: "members" | "cost") => void;
  isNewChatDisabled?: boolean;
  newChatDisabledReason?: string;
}

export type ShortcutId = "new" | "images" | "apps" | "research" | "codex" | "projects";
type SidebarModeId = "web-search" | "agent";

interface ShortcutItem {
  id: ShortcutId;
  label: string;
}

const SHORTCUTS: ShortcutItem[] = [
  { id: "new", label: "New chat" },
  { id: "images", label: "Images" },
  { id: "apps", label: "Apps" },
  { id: "research", label: "Deep research" },
  { id: "codex", label: "Codex" },
  { id: "projects", label: "Projects" }
];

function buildInitials(userName: string): string {
  const parts = userName
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }
  return userName.slice(0, 2).toUpperCase();
}

// Neural network logo — matches the preview exactly.
// 3 layers: 2 input nodes → 3 hidden (purple) → 2 output nodes.
function NeuralNetworkLogo() {
  return (
    <svg
      viewBox="0 0 36 36"
      width="36"
      height="36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Input → Hidden connections */}
      <line x1="5"  y1="9"  x2="16" y2="5"  stroke="currentColor" strokeWidth="1" strokeOpacity="0.50" />
      <line x1="5"  y1="9"  x2="16" y2="18" stroke="currentColor" strokeWidth="1" strokeOpacity="0.50" />
      <line x1="5"  y1="9"  x2="16" y2="31" stroke="currentColor" strokeWidth="1" strokeOpacity="0.28" />
      <line x1="5"  y1="27" x2="16" y2="5"  stroke="currentColor" strokeWidth="1" strokeOpacity="0.28" />
      <line x1="5"  y1="27" x2="16" y2="18" stroke="currentColor" strokeWidth="1" strokeOpacity="0.50" />
      <line x1="5"  y1="27" x2="16" y2="31" stroke="currentColor" strokeWidth="1" strokeOpacity="0.50" />

      {/* Hidden → Output connections */}
      <line x1="16" y1="5"  x2="31" y2="12" stroke="currentColor" strokeWidth="1" strokeOpacity="0.50" />
      <line x1="16" y1="5"  x2="31" y2="24" stroke="currentColor" strokeWidth="1" strokeOpacity="0.28" />
      <line x1="16" y1="18" x2="31" y2="12" stroke="currentColor" strokeWidth="1" strokeOpacity="0.60" />
      <line x1="16" y1="18" x2="31" y2="24" stroke="currentColor" strokeWidth="1" strokeOpacity="0.60" />
      <line x1="16" y1="31" x2="31" y2="12" stroke="currentColor" strokeWidth="1" strokeOpacity="0.28" />
      <line x1="16" y1="31" x2="31" y2="24" stroke="currentColor" strokeWidth="1" strokeOpacity="0.50" />

      {/* Input nodes — muted */}
      <circle cx="5"  cy="9"  r="2.8" fill="currentColor" fillOpacity="0.75" />
      <circle cx="5"  cy="27" r="2.8" fill="currentColor" fillOpacity="0.75" />

      {/* Hidden nodes — purple accent */}
      <circle cx="16" cy="5"  r="2.8" fill="#7F77DD" />
      <circle cx="16" cy="18" r="3.4" fill="#7F77DD" />
      <circle cx="16" cy="31" r="2.8" fill="#7F77DD" />

      {/* Output nodes — full color */}
      <circle cx="31" cy="12" r="2.8" fill="currentColor" />
      <circle cx="31" cy="24" r="2.8" fill="currentColor" />
    </svg>
  );
}

function ShortcutIcon({ id }: { id: ShortcutId }) {
  if (id === "new") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 16V20H8L18.5 9.5L14.5 5.5L4 16Z" stroke="currentColor" strokeWidth="1.7" />
        <path d="M13.5 6.5L17.5 10.5" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }

  if (id === "images") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3.5" y="5" width="14" height="14" rx="3" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="9" cy="10" r="1.6" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 16L10 12L14 16L17 13" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    );
  }

  if (id === "apps") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="4" y="4" width="6" height="6" rx="2" stroke="currentColor" strokeWidth="1.7" />
        <rect x="14" y="4" width="6" height="6" rx="2" stroke="currentColor" strokeWidth="1.7" />
        <rect x="4" y="14" width="6" height="6" rx="2" stroke="currentColor" strokeWidth="1.7" />
        <rect x="14" y="14" width="6" height="6" rx="2" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }

  if (id === "research") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 20L9 15M20 20L15 15M12 6V13M8 10L12 6L16 10" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="12" cy="6" r="2.8" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }

  if (id === "codex") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M8.5 8L5 12L8.5 16M15.5 8L19 12L15.5 16M10.5 18H13.5" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 8C4 6.9 4.9 6 6 6H11L13 8H18C19.1 8 20 8.9 20 10V17C20 18.1 19.1 19 18 19H6C4.9 19 4 18.1 4 17V8Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 12V16M10 14H14" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function SidebarModeIcon({ id }: { id: SidebarModeId }) {
  if (id === "web-search") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" />
        <path d="M16 16L20 20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="7" y="8" width="10" height="8" rx="3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 4V8M9 18H15M8 21H16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="10" cy="12" r="0.8" fill="currentColor" />
      <circle cx="14" cy="12" r="0.8" fill="currentColor" />
    </svg>
  );
}

export function Sidebar({
  historyItems,
  archivedHistoryItems,
  activeConversationId,
  isMobileOpen,
  isCollapsed = false,
  projects = [],
  activeProjectId,
  userName,
  userSubtitle,
  themeMode,
  isWebSearchMode,
  isWebSearchAvailable,
  isAgentMode,
  activeShortcutId = "new",
  onNewChat,
  onSelectConversation,
  onToggleArchiveConversation,
  onDeleteConversation,
  onShareConversation,
  onToggleWebSearchMode,
  onToggleAgentMode,
  onThemeModeChange,
  onOpenSettings,
  onOpenUserSettings,
  onSignOut,
  onCloseMobile,
  onToggleCollapse,
  onOpenImages,
  onOpenApps,
  onOpenResearch,
  onOpenCodex,
  onOpenProjects,
  onCreateProject,
  onOpenProject,
  onOpenSettingsSection,
  isNewChatDisabled = false,
  newChatDisabledReason,
}: SidebarProps) {
  const { can, isAtLeast, role } = useRBAC();
  const userInitials = buildInitials(userName);
  const [openMenuConversationId, setOpenMenuConversationId] = useState<string | null>(null);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const menuRootReference = useRef<HTMLDivElement | null>(null);
  const userMenuReference = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      if (menuRootReference.current?.contains(target)) {
        return;
      }

      if (userMenuReference.current?.contains(target)) {
        return;
      }

      setOpenMenuConversationId(null);
      setIsUserMenuOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenuConversationId(null);
        setIsUserMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  function toggleUserMenu() {
    setOpenMenuConversationId(null);
    setIsUserMenuOpen((previous) => !previous);
  }

  function handleCollapsedUserChipKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!isCollapsed) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleUserMenu();
    }
  }

  function renderUserMenu() {
    return (
      <div className={`nc-user-menu ${isCollapsed ? "nc-user-menu--collapsed" : ""}`} role="menu" aria-label="User settings menu">
        <div className="nc-user-menu__section" role="none">
          <p className="nc-user-menu__section-title">Theme</p>
          <div className="nc-user-menu__theme-group" role="none">
            {(
              [
                { value: "system", label: "System" },
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" }
              ] as const
            ).map((themeOption) => {
              const isThemeActive = themeMode === themeOption.value;

              return (
                <button
                  key={themeOption.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isThemeActive}
                  className={`nc-user-menu__theme-item ${isThemeActive ? "nc-user-menu__theme-item--active" : ""}`}
                  onClick={() => {
                    onThemeModeChange(themeOption.value);
                    setIsUserMenuOpen(false);
                  }}
                >
                  <span>{themeOption.label}</span>
                  {isThemeActive ? <span aria-hidden="true">✓</span> : null}
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onOpenSettings();
            setIsUserMenuOpen(false);
          }}
        >
          Settings
        </button>
        {isAtLeast("owner") ? (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onOpenSettingsSection?.("members");
              setIsUserMenuOpen(false);
            }}
          >
            Members
          </button>
        ) : null}
        {isAtLeast("owner") ? (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onOpenSettingsSection?.("cost");
              setIsUserMenuOpen(false);
            }}
          >
            Billing
          </button>
        ) : null}
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onOpenUserSettings();
            setIsUserMenuOpen(false);
          }}
        >
          Manage account
        </button>
        <button
          type="button"
          role="menuitem"
          className="nc-user-menu__danger"
          onClick={() => {
            onSignOut();
            setIsUserMenuOpen(false);
          }}
        >
          Sign out
        </button>
      </div>
    );
  }

  function handleShortcutClick(id: ShortcutId) {
    onCloseMobile();

    switch (id) {
      case "new":
        onNewChat();
        break;
      case "images":
        onOpenImages?.();
        break;
      case "apps":
        onOpenApps?.();
        break;
      case "research":
        onOpenResearch?.();
        break;
      case "codex":
        onOpenCodex?.();
        break;
      case "projects":
        onOpenProjects?.();
        break;
    }
  }

  function renderConversationItem(conversation: ConversationSummary) {
    const isActive = conversation.id === activeConversationId;
    const isMenuOpen = openMenuConversationId === conversation.id;
    const isArchived = conversation.archived === true;

    return (
      <div key={conversation.id} className={`nc-history-row ${isActive ? "nc-history-row--active" : ""}`}>
        <button
          type="button"
          className={`nc-history-main ${isActive ? "nc-history-main--active" : ""}`}
          onClick={() => {
            onSelectConversation(conversation.id);
            onCloseMobile();
          }}
          title={conversation.title}
        >
          <span className="nc-history-item__text">{conversation.title}</span>
        </button>

        <div className="nc-history-menu-wrap" ref={isMenuOpen ? menuRootReference : null}>
          <button
            type="button"
            className={`nc-history-item__menu-btn ${isMenuOpen ? "nc-history-item__menu-btn--open" : ""}`}
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
            aria-label={`Open actions for ${conversation.title}`}
            onClick={(event) => {
              event.stopPropagation();
              setIsUserMenuOpen(false);
              setOpenMenuConversationId((previous) => (previous === conversation.id ? null : conversation.id));
            }}
          >
            ⋯
          </button>

          {isMenuOpen ? (
            <div className="nc-history-menu" role="menu" aria-label={`Chat actions for ${conversation.title}`}>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onShareConversation(conversation.id);
                  setOpenMenuConversationId(null);
                }}
              >
                Share chat
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onToggleArchiveConversation(conversation.id);
                  setOpenMenuConversationId(null);
                }}
              >
                {isArchived ? "Unarchive chat" : "Archive chat"}
              </button>
              <button
                type="button"
                role="menuitem"
                className="nc-history-menu__danger"
                onClick={() => {
                  onDeleteConversation(conversation.id);
                  setOpenMenuConversationId(null);
                }}
              >
                Delete chat
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  function ProjectSidebarIcon({ kind }: { kind: "new" | "project" }) {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M4 8C4 6.9 4.9 6 6 6H10.6L12.6 8H18C19.1 8 20 8.9 20 10V17C20 18.1 19.1 19 18 19H6C4.9 19 4 18.1 4 17V8Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        {kind === "new" ? <path d="M12 11.3V15.7M9.8 13.5H14.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /> : null}
      </svg>
    );
  }

  function renderProjectSubitems() {
    if (isCollapsed || (projects.length === 0 && activeShortcutId !== "projects")) {
      return null;
    }

    return (
      <div className="nc-project-subnav">
        {can("project:create") ? (
          <button
            type="button"
            className="nc-project-subnav__item nc-project-subnav__item--new"
            onClick={() => {
              onCreateProject?.();
              onCloseMobile();
            }}
          >
            <span className="nc-project-subnav__icon nc-project-subnav__icon--folder">
              <ProjectSidebarIcon kind="new" />
            </span>
            <span className="nc-project-subnav__label">New project</span>
          </button>
        ) : null}

        {projects.map((project) => (
          <button
            key={project.project_id}
            type="button"
            className={`nc-project-subnav__item ${activeProjectId === project.project_id ? "nc-project-subnav__item--active" : ""}`}
            aria-current={activeProjectId === project.project_id ? "page" : undefined}
            onClick={() => {
              onOpenProject?.(project.project_id);
              onCloseMobile();
            }}
            title={project.name}
          >
            <span className="nc-project-subnav__icon nc-project-subnav__icon--folder">
              <ProjectSidebarIcon kind="project" />
            </span>
            <span className="nc-project-subnav__label">{project.name}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <aside
      className={`nc-sidebar ${isMobileOpen ? "nc-sidebar--open" : ""} ${isCollapsed ? "nc-sidebar--collapsed" : ""}`}
      aria-label="Conversation sidebar"
      data-testid="conversation-sidebar"
    >
      <div className="nc-sidebar__top">
        <div className="nc-brand-row">
          <div className="nc-brand-lockup">
            {/* Neural network logo */}
            <span className="nc-brand-mark" aria-hidden="true">
              <NeuralNetworkLogo />
            </span>
            <span className="nc-brand-copy">
              <span className="nc-brand-name">NeuralChat</span>
              <span className="nc-brand-subtitle">AI Chat Assistant</span>
            </span>
          </div>
          <button
            type="button"
            className="nc-sidebar-pane-btn"
            onClick={onToggleCollapse}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="4" y="4" width="16" height="16" rx="4" stroke="currentColor" strokeWidth="1.7" />
              <path d="M12 4V20" stroke="currentColor" strokeWidth="1.7" />
            </svg>
          </button>
        </div>

        <nav className="nc-shortcuts" aria-label="Primary shortcuts">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.id} className="nc-shortcut-group">
              <button
                type="button"
                className={`nc-shortcut-item ${activeShortcutId === shortcut.id ? "nc-shortcut-item--active" : ""}`}
                onClick={() => handleShortcutClick(shortcut.id)}
                aria-label={shortcut.label}
                aria-current={activeShortcutId === shortcut.id ? "page" : undefined}
                title={
                  shortcut.id === "new" && isNewChatDisabled
                    ? newChatDisabledReason
                    : isCollapsed
                      ? shortcut.label
                      : undefined
                }
                disabled={shortcut.id === "new" && isNewChatDisabled}
              >
                <span className="nc-shortcut-item__icon">
                  <ShortcutIcon id={shortcut.id} />
                </span>
                <span className="nc-shortcut-item__label">{shortcut.label}</span>
              </button>

              {shortcut.id === "new" ? (
                <button
                  type="button"
                  className={`nc-shortcut-subitem ${isWebSearchMode ? "nc-shortcut-subitem--active" : ""}`}
                  aria-label="Toggle Web Search Mode"
                  aria-pressed={isWebSearchMode}
                  disabled={!isWebSearchAvailable}
                  onClick={() => {
                    onToggleWebSearchMode();
                    onCloseMobile();
                  }}
                >
                  <span className="nc-shortcut-subitem__icon">
                    <SidebarModeIcon id="web-search" />
                  </span>
                  <span className="nc-shortcut-subitem__label">Web search</span>
                  <span className={`nc-shortcut-subitem__state ${isWebSearchMode ? "nc-shortcut-subitem__state--active" : ""}`}>
                    {!isWebSearchAvailable ? "Unavailable" : isWebSearchMode ? "On" : "Off"}
                  </span>
                </button>
              ) : null}

              {shortcut.id === "codex" && can("agent:run") ? (
                <button
                  type="button"
                  className={`nc-shortcut-subitem ${isAgentMode ? "nc-shortcut-subitem--active" : ""}`}
                  aria-label="Toggle Agent Mode"
                  aria-pressed={isAgentMode}
                  onClick={() => {
                    onToggleAgentMode();
                    onCloseMobile();
                  }}
                >
                  <span className="nc-shortcut-subitem__icon">
                    <SidebarModeIcon id="agent" />
                  </span>
                  <span className="nc-shortcut-subitem__label">Agent mode</span>
                  <span className={`nc-shortcut-subitem__state ${isAgentMode ? "nc-shortcut-subitem__state--active" : ""}`}>
                    {isAgentMode ? "On" : "Off"}
                  </span>
                </button>
              ) : null}

              {shortcut.id === "projects" ? renderProjectSubitems() : null}
            </div>
          ))}
        </nav>
      </div>

      <div className="nc-history-scroll nc-history-scroll--flat">
        {/* ✅ Renamed from "Your chats" to "Recents" */}
        <h3 className="nc-history-label">Recents</h3>
        <div className="nc-history-list">
          {historyItems.map((conversation) => renderConversationItem(conversation))}
        </div>

        {archivedHistoryItems.length > 0 ? (
          <>
            <h3 className="nc-history-label nc-history-label--secondary">Archived chats</h3>
            <div className="nc-history-list nc-history-list--archived">
              {archivedHistoryItems.map((conversation) => renderConversationItem(conversation))}
            </div>
          </>
        ) : null}
      </div>

      <div className="nc-sidebar__bottom">
        <div
          className={`nc-user-chip ${isCollapsed ? "nc-user-chip--collapsed-trigger" : ""}`}
          title={isCollapsed ? undefined : `${userName} (${userSubtitle})`}
          onClick={isCollapsed ? toggleUserMenu : undefined}
          onKeyDown={handleCollapsedUserChipKeyDown}
          role={isCollapsed ? "button" : undefined}
          tabIndex={isCollapsed ? 0 : undefined}
          aria-haspopup={isCollapsed ? "menu" : undefined}
          aria-expanded={isCollapsed ? isUserMenuOpen : undefined}
          aria-label={isCollapsed ? `Open user menu for ${userName}` : undefined}
          ref={isUserMenuOpen && isCollapsed ? userMenuReference : null}
        >
          <span className="nc-user-avatar">{userInitials}</span>
          <span className="nc-user-meta">
            <span style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span className="nc-user-name">{userName}</span>
              <RoleBadge role={role} size="sm" />
            </span>
            <span className="nc-user-subtitle">{userSubtitle}</span>
          </span>
          <div className="nc-user-menu-wrap" ref={isUserMenuOpen && !isCollapsed ? userMenuReference : null}>
            {!isCollapsed ? (
              <button
                type="button"
                className={`nc-user-settings ${isUserMenuOpen ? "nc-user-settings--open" : ""}`}
                aria-label="More options"
                aria-haspopup="menu"
                aria-expanded={isUserMenuOpen}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleUserMenu();
                }}
              >
                ⋯
              </button>
            ) : null}

            {isUserMenuOpen && !isCollapsed ? renderUserMenu() : null}
          </div>

          {isUserMenuOpen && isCollapsed ? renderUserMenu() : null}
        </div>
      </div>
    </aside>
  );
}
