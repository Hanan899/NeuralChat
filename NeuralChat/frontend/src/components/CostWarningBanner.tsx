interface CostWarningBannerProps {
  summary: {
    today_cost_usd: number;
    daily_limit_usd: number;
    percentage_used: number;
    limit_exceeded: boolean;
  };
  onDismiss: () => void;
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function CostWarningBanner({ summary, onDismiss }: CostWarningBannerProps) {
  if (summary.percentage_used < 80) {
    return null;
  }

  return (
    <section
      className={`nc-cost-warning ${summary.limit_exceeded ? "nc-cost-warning--danger" : "nc-cost-warning--warning"}`}
      aria-label="Daily budget warning"
    >
      <div className="nc-cost-warning__copy">
        <p className="nc-cost-warning__title">Daily budget warning</p>
        <p className="nc-cost-warning__text">
          You&apos;ve used {Math.round(summary.percentage_used)}% of your daily budget ({formatCurrency(summary.today_cost_usd)} / {formatCurrency(summary.daily_limit_usd)}). Consider reducing usage.
        </p>
      </div>
      <button
        type="button"
        className="nc-cost-warning__dismiss"
        aria-label="Dismiss cost warning"
        onClick={onDismiss}
      >
        ×
      </button>
    </section>
  );
}
