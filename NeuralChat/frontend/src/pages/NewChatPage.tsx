import { NeuralNetworkLogo } from "../components/NeuralNetworkLogo";

const EMPTY_SUGGESTIONS = [
  "Summarize this project architecture in simple terms",
  "Help me debug my API latency",
  "Write a clean README section for setup",
  "Give me a step-by-step learning path",
];

interface NewChatPageProps {
  onSuggestionSelect: (suggestion: string) => void;
}

export function NewChatPage({ onSuggestionSelect }: NewChatPageProps) {
  return (
    <section className="nc-new-chat-page" data-testid="empty-state">
      <NeuralNetworkLogo />
      <h2>How can I help you today?</h2>
      <div className="nc-new-chat-page__chips">
        {EMPTY_SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="nc-new-chat-page__chip"
            onClick={() => onSuggestionSelect(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </section>
  );
}
