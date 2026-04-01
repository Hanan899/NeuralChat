import { ReactNode, useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";

import type { ChatMessage } from "../types";
import { MessageBubble } from "./MessageBubble";

interface ChatWindowProps {
  messages: ChatMessage[];
  streamingMessageId?: string | null;
  onRetryPrompt?: (prompt: string) => void;
  onRunAgentPlan?: (messageId: string) => void;
  onConfirmAgentAction?: (messageId: string, approved: boolean) => void;
  footer?: ReactNode;
}

function findPreviousUserPrompt(messages: ChatMessage[], assistantIndex: number): string | null {
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return messages[index].content;
    }
  }
  return null;
}

export function ChatWindow({ messages, streamingMessageId, onRetryPrompt, onRunAgentPlan, onConfirmAgentAction, footer }: ChatWindowProps) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLElement | null>(null);
  const shouldStickToBottomRef = useRef(true);

  const renderedMessages = useMemo(
    () =>
      messages.map((message, index) => {
        const previousRole = index > 0 ? messages[index - 1].role : null;
        const showAssistantLabel = message.role === "assistant" && previousRole !== "assistant";
        const retryPrompt = message.role === "assistant" ? findPreviousUserPrompt(messages, index) : null;
        return {
          message,
          showAssistantLabel,
          retryPrompt,
        };
      }),
    [messages]
  );

  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer || !shouldStickToBottomRef.current) {
      return;
    }

    if (typeof scrollContainer.scrollTo === "function") {
      scrollContainer.scrollTo({
        top: scrollContainer.scrollHeight,
        behavior: "auto",
      });
      return;
    }

    scrollContainer.scrollTop = scrollContainer.scrollHeight;
  }, [messages, streamingMessageId]);

  function handleScroll() {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) {
      return;
    }
    const distanceFromBottom =
      scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom <= 96;
  }

  return (
    <section ref={scrollRef} className="nc-message-scroll" aria-live="polite" onScroll={handleScroll}>
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
                onRunAgentPlan={message.agentTask && onRunAgentPlan ? () => onRunAgentPlan(message.id) : undefined}
                onConfirmAgentAction={
                  message.agentTask && onConfirmAgentAction ? (approved) => onConfirmAgentAction(message.id, approved) : undefined
                }
              />
            </motion.div>
          ))}
        </AnimatePresence>
        {footer}
        <div ref={endRef} />
      </div>
    </section>
  );
}
