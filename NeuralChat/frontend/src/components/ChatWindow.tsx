import { useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";

import type { ChatMessage } from "../types";
import { MessageBubble } from "./MessageBubble";

interface ChatWindowProps {
  messages: ChatMessage[];
  streamingMessageId?: string | null;
  onRetryPrompt?: (prompt: string) => void;
}

function findPreviousUserPrompt(messages: ChatMessage[], assistantIndex: number): string | null {
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return messages[index].content;
    }
  }
  return null;
}

export function ChatWindow({ messages, streamingMessageId, onRetryPrompt }: ChatWindowProps) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLElement | null>(null);

  const renderedMessages = useMemo(
    () =>
      messages.map((message, index) => {
        const previousRole = index > 0 ? messages[index - 1].role : null;
        const showAssistantLabel = message.role === "assistant" && previousRole !== "assistant";
        const retryPrompt = message.role === "assistant" ? findPreviousUserPrompt(messages, index) : null;
        return {
          message,
          showAssistantLabel,
          retryPrompt
        };
      }),
    [messages]
  );

  useEffect(() => {
    if (scrollRef.current) {
      if (typeof scrollRef.current.scrollTo === "function") {
        scrollRef.current.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: "smooth"
        });
      } else {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
      return;
    }

    if (endRef.current && typeof endRef.current.scrollIntoView === "function") {
      endRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, streamingMessageId]);

  return (
    <section ref={scrollRef} className="nc-message-scroll" aria-live="polite">
      <div className="nc-message-inner">
        <AnimatePresence initial={false}>
          {renderedMessages.map(({ message, showAssistantLabel, retryPrompt }) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <MessageBubble
                message={message}
                isStreaming={message.role === "assistant" && message.id === streamingMessageId}
                showAssistantLabel={showAssistantLabel}
                onRetry={
                  retryPrompt && onRetryPrompt
                    ? () => {
                        onRetryPrompt(retryPrompt);
                      }
                    : undefined
                }
              />
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={endRef} />
      </div>
    </section>
  );
}
