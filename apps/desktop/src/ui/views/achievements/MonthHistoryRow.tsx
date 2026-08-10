import { AchievementMedal } from "../../AchievementBadge";
import type { MonthHistory } from "./achievementCatalog";

export function MonthHistoryRow({ month }: { month: MonthHistory }) {
  const accessibleLabel = `Highest monthly milestone reached in ${month.label}. Exact totals for past months are not stored.`;
  return (
    <article
      aria-label={accessibleLabel}
      title={accessibleLabel}
      className="flex min-w-0 items-center justify-between gap-5 rounded-xl border border-border bg-bg px-4 py-3"
    >
      <div className="min-w-0">
        <h3 className="font-semibold text-text">{month.label}</h3>
        <p className="mt-0.5 text-xs text-text-muted">
          {month.highestThreshold.toLocaleString()}h milestone reached
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {month.earned.map((item) => (
          <AchievementMedal
            key={item.id}
            notification={{
              id: item.id,
              kind: item.kind,
              title: item.title,
              coverUrl: item.coverUrl,
            }}
            size="sm"
          />
        ))}
      </div>
    </article>
  );
}
