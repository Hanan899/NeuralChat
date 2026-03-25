interface SkeletonCardProps {
  rows?: number;
  showAvatar?: boolean;
}

export function SkeletonCard({ rows = 3, showAvatar = false }: SkeletonCardProps) {
  return (
    <div className="nc-skeleton-card" aria-hidden="true">
      {showAvatar ? <div className="nc-skeleton-card__avatar" /> : null}
      <div className="nc-skeleton-card__body">
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            className={`nc-skeleton-card__row ${index === 0 ? "nc-skeleton-card__row--wide" : ""}`}
          />
        ))}
      </div>
    </div>
  );
}
