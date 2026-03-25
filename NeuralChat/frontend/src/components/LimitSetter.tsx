import { useEffect, useState } from "react";

interface LimitSetterProps {
  label: string;
  limitUsd: number;
  isSaving: boolean;
  onSave: (nextLimitUsd: number) => Promise<void>;
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function LimitSetter({ label, limitUsd, isSaving, onSave }: LimitSetterProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftValue, setDraftValue] = useState(limitUsd.toFixed(2));
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    if (!isEditing) {
      setDraftValue(limitUsd.toFixed(2));
    }
  }, [limitUsd, isEditing]);

  async function handleSave() {
    const parsedValue = Number(draftValue);
    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
      setErrorText(`${label} must be greater than zero.`);
      return;
    }

    setErrorText("");
    await onSave(parsedValue);
    setIsEditing(false);
  }

  return (
    <section className="nc-cost-limit">
      <div>
        <p className="nc-cost-section-label">{label}</p>
        {!isEditing ? <p className="nc-cost-limit__value">{formatCurrency(limitUsd)}</p> : null}
      </div>

      {!isEditing ? (
        <button
          type="button"
          className="nc-cost-limit__edit"
          onClick={() => {
            setDraftValue(limitUsd.toFixed(2));
            setErrorText("");
            setIsEditing(true);
          }}
        >
          Edit
        </button>
      ) : (
        <div className="nc-cost-limit__editor">
          <label className="nc-cost-limit__label" htmlFor={`${label.toLowerCase().replace(/\s+/g, "-")}-input`}>
            {label}
          </label>
          <div className="nc-cost-limit__controls">
            <input
              id={`${label.toLowerCase().replace(/\s+/g, "-")}-input`}
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
                setDraftValue(limitUsd.toFixed(2));
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
