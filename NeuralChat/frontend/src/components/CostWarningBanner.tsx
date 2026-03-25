import type { UsageStatusResponse } from "../types";

interface CostWarningBannerProps {
  status: UsageStatusResponse;
  onDismiss: () => void;
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

function buildWarningCopy(status: UsageStatusResponse): { title: string; text: string; danger: boolean } | null {
  if (status.blocked && status.blocking_period === "daily") {
    return {
      title: "Daily budget limit reached",
      text: status.blocking_message,
      danger: true,
    };
  }

  if (status.blocked && status.blocking_period === "monthly") {
    return {
      title: "Monthly budget limit reached",
      text: status.blocking_message,
      danger: true,
    };
  }

  if (status.daily.warning_triggered) {
    return {
      title: "Daily budget warning",
      text: `You've used ${Math.round(status.daily.percentage_used)}% of your daily budget (${formatCurrency(status.daily.spent_usd)} / ${formatCurrency(status.daily.limit_usd)}). Consider reducing usage.`,
      danger: false,
    };
  }

  if (status.monthly.warning_triggered) {
    return {
      title: "Monthly budget warning",
      text: `You've used ${Math.round(status.monthly.percentage_used)}% of your monthly budget (${formatCurrency(status.monthly.spent_usd)} / ${formatCurrency(status.monthly.limit_usd)}). Consider reducing usage.`,
      danger: false,
    };
  }

  return null;
}

export function CostWarningBanner({ status, onDismiss }: CostWarningBannerProps) {
  const copy = buildWarningCopy(status);
  if (!copy) {
    return null;
  }

  return (
    <section
      className={`nc-cost-warning ${copy.danger ? "nc-cost-warning--danger" : "nc-cost-warning--warning"}`}
      aria-label={`${copy.title}`}
    >
      <div className="nc-cost-warning__copy">
        <p className="nc-cost-warning__title">{copy.title}</p>
        <p className="nc-cost-warning__text">{copy.text}</p>
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
