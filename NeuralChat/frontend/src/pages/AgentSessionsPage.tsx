import { useMemo, useState } from "react";

import type { ConversationSummary } from "../types";

interface AgentSessionsPageProps {
  conversations: ConversationSummary[];
  activeConversationId: string;
  onOpenConversation: (conversationId: string) => void;
  onCreateConversation: () => void;
}

function formatRelativeTime(timestamp: string): string {
  const parsedTime = new Date(timestamp);
  if (Number.isNaN(parsedTime.getTime())) {
    return "Updated recently";
  }

  const differenceSeconds = Math.max(0, Math.round((Date.now() - parsedTime.getTime()) / 1000));
  if (differenceSeconds < 45) {
    return "Last message just now";
  }
  if (differenceSeconds < 3600) {
    return `Last message ${Math.round(differenceSeconds / 60)} minutes ago`;
  }
  if (differenceSeconds < 86_400) {
    return `Last message ${Math.round(differenceSeconds / 3600)} hours ago`;
  }
  return `Last message ${Math.round(differenceSeconds / 86_400)} day${differenceSeconds < 172_800 ? "" : "s"} ago`;
}

export function AgentSessionsPage({
  conversations,
  activeConversationId,
  onOpenConversation,
  onCreateConversation,
}: AgentSessionsPageProps) {
  const [searchValue, setSearchValue] = useState("");

  const filteredConversations = useMemo(() => {
    const normalizedQuery = searchValue.trim().toLowerCase();
    if (!normalizedQuery) {
      return conversations;
    }

    return conversations.filter((conversation) => {
      const title = conversation.title.toLowerCase();
      const preview = conversation.preview.toLowerCase();
      return title.includes(normalizedQuery) || preview.includes(normalizedQuery);
    });
  }, [conversations, searchValue]);

  return (
    <section className="nc-agent-chats-page" data-testid="agent-sessions-page">
      <header className="nc-agent-chats-page__header">
        <div className="nc-agent-chats-page__header-copy">
          <p className="nc-agent-chats-page__eyebrow">Agent mode</p>
          <h2>Chats</h2>
        </div>

        <button type="button" className="nc-button nc-button--primary" onClick={onCreateConversation}>
          + New chat
        </button>
      </header>

      <label className="nc-agent-chats-page__search">
        <span className="nc-agent-chats-page__search-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" />
            <path d="M16 16L20 20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </span>
        <input
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
          placeholder="Search your chats..."
          aria-label="Search your agent chats"
        />
      </label>

      <div className="nc-agent-chats-page__meta">
        <span>Your agent chats</span>
        <strong>{conversations.length}</strong>
      </div>

      {filteredConversations.length === 0 ? (
        <div className="nc-agent-chats-page__empty">
          <strong>{conversations.length === 0 ? "No agent chats yet" : "No matching chats found"}</strong>
          <p>
            {conversations.length === 0
              ? "Start a dedicated Agent mode conversation when you need deep reasoning or multi-step execution."
              : "Try another search term or start a fresh Agent mode chat."}
          </p>
        </div>
      ) : (
        <div className="nc-agent-chats-page__list">
          {filteredConversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              className={`nc-agent-chats-page__row ${
                conversation.id === activeConversationId ? "nc-agent-chats-page__row--active" : ""
              }`}
              onClick={() => onOpenConversation(conversation.id)}
            >
              <span className="nc-agent-chats-page__row-title">
                {conversation.title.trim() || "Untitled agent chat"}
              </span>
              <span className="nc-agent-chats-page__row-meta">{formatRelativeTime(conversation.updatedAt)}</span>
              {conversation.preview.trim() ? (
                <span className="nc-agent-chats-page__row-preview">{conversation.preview}</span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
