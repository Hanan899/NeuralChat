import { useEffect, useState } from "react";

interface LimitSetterProps {
  dailyLimitUsd: number;
  isSaving: boolean;
  onSave: (nextLimitUsd: number) => Promise<void>;
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function LimitSetter({ dailyLimitUsd, isSaving, onSave }: LimitSetterProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftValue, setDraftValue] = useState(dailyLimitUsd.toFixed(2));
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    if (!isEditing) {
      setDraftValue(dailyLimitUsd.toFixed(2));
    }
  }, [dailyLimitUsd, isEditing]);

  async function handleSave() {
    const parsedValue = Number(draftValue);
    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
      setErrorText("Daily limit must be greater than zero.");
      return;
    }

    setErrorText("");
    await onSave(parsedValue);
    setIsEditing(false);
  }

  return (
    <section className="nc-cost-limit">
      <div>
        <p className="nc-cost-section-label">Daily limit</p>
        {!isEditing ? <p className="nc-cost-limit__value">{formatCurrency(dailyLimitUsd)}</p> : null}
      </div>

      {!isEditing ? (
        <button
          type="button"
          className="nc-cost-limit__edit"
          onClick={() => {
            setDraftValue(dailyLimitUsd.toFixed(2));
            setErrorText("");
            setIsEditing(true);
          }}
        >
          Edit
        </button>
      ) : (
        <div className="nc-cost-limit__editor">
          <label className="nc-cost-limit__label" htmlFor="daily-limit-input">
            Daily limit
          </label>
          <div className="nc-cost-limit__controls">
            <input
              id="daily-limit-input"
              type="number"
              min="0.01"
              step="0.01"
              value={draftValue}
              onChange={(event) => setDraftValue(event.target.value)}
            />
            <button type="button" onClick={() => void handleSave()} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              className="nc-cost-limit__cancel"
              onClick={() => {
                setDraftValue(dailyLimitUsd.toFixed(2));
                setErrorText("");
                setIsEditing(false);
              }}
              disabled={isSaving}
            >
              Cancel
            </button>
          </div>
          {errorText ? <p className="nc-cost-limit__error">{errorText}</p> : null}
        </div>
      )}
    </section>
  );
}
