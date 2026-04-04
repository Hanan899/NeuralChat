import { useEffect, useMemo, useRef, useState } from "react";

interface TokenUsageSnapshot {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  contextWindowTokens?: number;
  contextPercentageUsed?: number;
}

interface TokenContextMeterProps {
  latestUsage: TokenUsageSnapshot | null;
  sessionTotals: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

function formatCompactTokens(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "0";
  }

  if (value < 1000) {
    return value.toLocaleString();
  }

  if (value < 1_000_000) {
    const compact = value / 1000;
    return `${compact.toFixed(1).replace(/\.0$/, "")}k`;
  }

  const compact = value / 1_000_000;
  return `${compact.toFixed(1).replace(/\.0$/, "")}m`;
}

function formatFullTokens(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }
  return value.toLocaleString();
}

export function TokenContextMeter({ latestUsage, sessionTotals }: TokenContextMeterProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isPinnedOpen, setIsPinnedOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const latestTotal = latestUsage?.totalTokens ?? null;
  const latestInput = latestUsage?.inputTokens ?? null;
  const latestOutput = latestUsage?.outputTokens ?? null;
  const contextWindowTokens = latestUsage?.contextWindowTokens ?? null;
  const contextPercentageUsed = latestUsage?.contextPercentageUsed ?? null;
  const hasLatestUsage =
    typeof latestTotal === "number" &&
    latestTotal > 0 &&
    typeof contextWindowTokens === "number" &&
    contextWindowTokens > 0;

  const toneClassName = useMemo(() => {
    if (!hasLatestUsage || typeof contextPercentageUsed !== "number") {
      return "nc-token-meter__trigger--quiet";
    }
    if (contextPercentageUsed >= 90) {
      return "nc-token-meter__trigger--high";
    }
    if (contextPercentageUsed >= 75) {
      return "nc-token-meter__trigger--warning";
    }
    return "nc-token-meter__trigger--healthy";
  }, [contextPercentageUsed, hasLatestUsage]);

  const isOpen = isHovered || isPinnedOpen;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (rootRef.current && target && !rootRef.current.contains(target)) {
        setIsPinnedOpen(false);
        setIsHovered(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsPinnedOpen(false);
        setIsHovered(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  const meterLabel = hasLatestUsage
    ? `${formatCompactTokens(latestTotal)} / ${formatCompactTokens(contextWindowTokens)}`
    : "Usage unavailable";
  const fillWidth = hasLatestUsage && typeof contextPercentageUsed === "number"
    ? Math.max(3, Math.min(contextPercentageUsed, 100))
    : 0;

  return (
    <div
      ref={rootRef}
      className={`nc-token-meter ${isOpen ? "nc-token-meter--open" : ""}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <button
        type="button"
        className={`nc-token-meter__trigger ${toneClassName}`}
        aria-label={
          hasLatestUsage
            ? `Latest request used ${formatFullTokens(latestTotal)} of ${formatFullTokens(contextWindowTokens)} context tokens`
            : "Token usage unavailable for this conversation"
        }
        aria-expanded={isOpen}
        onClick={() => setIsPinnedOpen((previous) => !previous)}
      >
        <span className="nc-token-meter__text">{meterLabel}</span>
        <span className="nc-token-meter__bar" aria-hidden="true">
          <span className="nc-token-meter__fill" style={{ width: `${fillWidth}%` }} />
        </span>
      </button>

      {isOpen ? (
        <div className="nc-token-meter__popover" role="dialog" aria-label="Token usage details">
          {hasLatestUsage ? (
            <>
              <div className="nc-token-meter__header">
                <span>Context usage</span>
                <strong>{typeof contextPercentageUsed === "number" ? `${contextPercentageUsed.toFixed(1)}%` : "—"}</strong>
              </div>
              <div className="nc-token-meter__rows">
                <div className="nc-token-meter__row">
                  <span>Prompt tokens</span>
                  <strong>{formatFullTokens(latestInput)}</strong>
                </div>
                <div className="nc-token-meter__row">
                  <span>Completion tokens</span>
                  <strong>{formatFullTokens(latestOutput)}</strong>
                </div>
                <div className="nc-token-meter__row nc-token-meter__row--total">
                  <span>Total</span>
                  <strong>
                    {formatFullTokens(latestTotal)} / {formatFullTokens(contextWindowTokens)}
                  </strong>
                </div>
              </div>
            </>
          ) : (
            <div className="nc-token-meter__empty">
              <strong>Usage unavailable</strong>
              <span>Send a message in this chat to populate token usage.</span>
            </div>
          )}

          <div className="nc-token-meter__divider" />
          <div className="nc-token-meter__session">
            <div className="nc-token-meter__section-title">Session total</div>
            <div className="nc-token-meter__row">
              <span>Input tokens</span>
              <strong>{formatFullTokens(sessionTotals.inputTokens)}</strong>
            </div>
            <div className="nc-token-meter__row">
              <span>Output tokens</span>
              <strong>{formatFullTokens(sessionTotals.outputTokens)}</strong>
            </div>
            <div className="nc-token-meter__row nc-token-meter__row--total">
              <span>Total tokens</span>
              <strong>{formatFullTokens(sessionTotals.totalTokens)}</strong>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
