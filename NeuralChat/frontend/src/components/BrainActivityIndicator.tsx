import { useEffect, useState } from "react";

type BrainActivityIndicatorProps = {
  activityToken: number;
  enabled: boolean;
};

export function BrainActivityIndicator({ activityToken, enabled }: BrainActivityIndicatorProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!enabled || activityToken <= 0) {
      setIsVisible(false);
      return;
    }

    setIsVisible(true);
    const timeoutId = window.setTimeout(() => {
      setIsVisible(false);
    }, 3000);
    return () => window.clearTimeout(timeoutId);
  }, [activityToken, enabled]);

  if (!enabled || !isVisible) {
    return null;
  }

  return (
    <div className="nc-brain-activity" data-testid="brain-activity-indicator">
      <span className="nc-brain-activity__dot" aria-hidden="true">🧠</span>
      <span>Learning from this conversation…</span>
    </div>
  );
}
