import { useEffect, useRef, useState } from "react";

import type { ConversationSummary, ThemeMode } from "../types";

interface SidebarProps {
  historyItems: ConversationSummary[];
  archivedHistoryItems: ConversationSummary[];
  activeConversationId: string;
  isMobileOpen: boolean;
  userName: string;
  userSubtitle: string;
  themeMode: ThemeMode;
  onNewChat: () => void;
  onSelectConversation: (conversationId: string) => void;
  onToggleArchiveConversation: (conversationId: string) => void;
  onDeleteConversation: (conversationId: string) => void;
  onShareConversation: (conversationId: string) => void;
  onThemeModeChange: (mode: ThemeMode) => void;
  onOpenUserSettings: () => void;
  onSignOut: () => void;
  onCloseMobile: () => void;
}

type ShortcutId = "new" | "images" | "apps" | "research" | "codex" | "projects";

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

export function Sidebar({
  historyItems,
  archivedHistoryItems,
  activeConversationId,
  isMobileOpen,
  userName,
  userSubtitle,
  themeMode,
  onNewChat,
  onSelectConversation,
  onToggleArchiveConversation,
  onDeleteConversation,
  onShareConversation,
  onThemeModeChange,
  onOpenUserSettings,
  onSignOut,
  onCloseMobile
}: SidebarProps) {
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

  return (
    <aside
      className={`nc-sidebar ${isMobileOpen ? "nc-sidebar--open" : ""}`}
      aria-label="Conversation sidebar"
      data-testid="conversation-sidebar"
    >
      <div className="nc-sidebar__top">
        <div className="nc-brand-row">
          <div className="nc-brand-lockup">
            <span className="nc-brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="8.3" stroke="currentColor" strokeWidth="1.7" />
                <path d="M8 12C8 9.8 9.8 8 12 8C14.2 8 16 9.8 16 12C16 14.2 14.2 16 12 16" stroke="currentColor" strokeWidth="1.7" />
              </svg>
            </span>
            <span className="nc-brand-name">NeuralChat</span>
          </div>
          <button type="button" className="nc-sidebar-pane-btn" onClick={onCloseMobile} aria-label="Close sidebar">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="4" y="4" width="16" height="16" rx="4" stroke="currentColor" strokeWidth="1.7" />
              <path d="M12 4V20" stroke="currentColor" strokeWidth="1.7" />
            </svg>
          </button>
        </div>

        <nav className="nc-shortcuts" aria-label="Primary shortcuts">
          {SHORTCUTS.map((shortcut) => (
            <button
              key={shortcut.id}
              type="button"
              className="nc-shortcut-item"
              onClick={shortcut.id === "new" ? onNewChat : undefined}
              aria-label={shortcut.label}
            >
              <span className="nc-shortcut-item__icon">
                <ShortcutIcon id={shortcut.id} />
              </span>
              <span>{shortcut.label}</span>
            </button>
          ))}
        </nav>
      </div>

      <div className="nc-history-scroll nc-history-scroll--flat">
        <h3 className="nc-history-label">Your chats</h3>
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
        <div className="nc-user-chip" title={`${userName} (${userSubtitle})`}>
          <span className="nc-user-avatar">{userInitials}</span>
          <span className="nc-user-meta">
            <span className="nc-user-name">{userName}</span>
            <span className="nc-user-subtitle">{userSubtitle}</span>
          </span>
          <div className="nc-user-menu-wrap" ref={isUserMenuOpen ? userMenuReference : null}>
            <button
              type="button"
              className={`nc-user-settings ${isUserMenuOpen ? "nc-user-settings--open" : ""}`}
              aria-label="Settings"
              aria-haspopup="menu"
              aria-expanded={isUserMenuOpen}
              onClick={(event) => {
                event.stopPropagation();
                setOpenMenuConversationId(null);
                setIsUserMenuOpen((previous) => !previous);
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 8.5C10.1 8.5 8.5 10.1 8.5 12C8.5 13.9 10.1 15.5 12 15.5C13.9 15.5 15.5 13.9 15.5 12C15.5 10.1 13.9 8.5 12 8.5Z" stroke="currentColor" strokeWidth="1.7" />
                <path d="M19 12.9V11.1L17.3 10.6C17.1 10.1 16.9 9.6 16.6 9.2L17.5 7.7L16.3 6.5L14.8 7.4C14.4 7.1 13.9 6.9 13.4 6.7L12.9 5H11.1L10.6 6.7C10.1 6.9 9.6 7.1 9.2 7.4L7.7 6.5L6.5 7.7L7.4 9.2C7.1 9.6 6.9 10.1 6.7 10.6L5 11.1V12.9L6.7 13.4C6.9 13.9 7.1 14.4 7.4 14.8L6.5 16.3L7.7 17.5L9.2 16.6C9.6 16.9 10.1 17.1 10.6 17.3L11.1 19H12.9L13.4 17.3C13.9 17.1 14.4 16.9 14.8 16.6L16.3 17.5L17.5 16.3L16.6 14.8C16.9 14.4 17.1 13.9 17.3 13.4L19 12.9Z" stroke="currentColor" strokeWidth="1.4" />
              </svg>
            </button>

            {isUserMenuOpen ? (
              <div className="nc-user-menu" role="menu" aria-label="User settings menu">
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
            ) : null}
          </div>
        </div>
      </div>
    </aside>
  );
}
