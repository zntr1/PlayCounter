import { Check, Trophy } from "lucide-react";
import { Panel } from "../../components";
import { AchievementMedal } from "../../AchievementBadge";
import { ACHIEVEMENT_TIERS } from "../../../achievementArt";
import { TOTAL_HOURS } from "../../../milestones";
import {
  type AchievementCatalogItem,
  type AchievementSummaryData,
} from "./achievementCatalog";

const TIER_SAMPLES = TOTAL_HOURS.map((threshold, index) => ({
  tier: ACHIEVEMENT_TIERS[index],
  id: `milestone:total:${threshold}`,
  kind: "milestone-total" as const,
}));

export function AchievementSummary({
  summary,
  recent,
}: {
  summary: AchievementSummaryData;
  recent: AchievementCatalogItem[];
}) {
  return (
    <div className="grid gap-4">
      <CollectionSummary summary={summary} />
      {recent.length > 0 ? <RecentUnlocks items={recent} /> : null}
    </div>
  );
}

function CollectionSummary({ summary }: { summary: AchievementSummaryData }) {
  return (
    <Panel className="relative overflow-hidden p-5">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full bg-accent/10 blur-3xl"
      />
      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent">
              Trophy case
            </p>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-mono text-4xl font-bold tabular-nums tracking-tight text-text">
                {summary.fixedUnlocked}
              </span>
              <span className="font-mono text-xl font-semibold tabular-nums text-text-faint">
                / {summary.fixedTotal}
              </span>
            </div>
            <p className="mt-1 text-sm text-text-muted">
              Core achievements unlocked · {summary.completionPct}% complete
            </p>
          </div>
          <div className="grid h-12 w-12 place-items-center rounded-xl border border-accent/30 bg-accent/10 text-accent">
            <Trophy aria-hidden="true" size={24} />
          </div>
        </div>
        <div
          className="mt-5 grid gap-1"
          style={{
            gridTemplateColumns: `repeat(${summary.fixedTotal}, minmax(0, 1fr))`,
          }}
          aria-label={`${summary.fixedUnlocked} of ${summary.fixedTotal} core achievements unlocked`}
          role="img"
        >
          {Array.from({ length: summary.fixedTotal }, (_, index) => (
            <span
              key={index}
              className={`h-2 rounded-full ${index < summary.fixedUnlocked ? "bg-accent" : "bg-surface-hover"}`}
            />
          ))}
        </div>
        <div className="mt-5 grid grid-cols-4 gap-2 xl:grid-cols-8">
          {TIER_SAMPLES.map((sample) => {
            const tier = sample.tier;
            if (!tier) return null;
            return (
              <div
                key={tier}
                className="flex min-w-0 items-center gap-2 rounded-lg bg-bg px-2.5 py-2"
              >
                <AchievementMedal
                  notification={{
                    id: sample.id,
                    kind: sample.kind,
                    title: `${tier} trophy`,
                  }}
                  size="sm"
                />
                <div className="min-w-0">
                  <div className="font-mono text-sm font-bold tabular-nums text-text">
                    {summary.byTier[tier]}
                  </div>
                  <div className="truncate text-[9px] font-bold uppercase tracking-wider text-text-faint">
                    {tier}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium text-text-muted">
          <span className="rounded-full border border-border bg-surface-hover px-2.5 py-1">
            +{summary.gameTrophies} game trophies
          </span>
          <span className="rounded-full border border-border bg-surface-hover px-2.5 py-1">
            +{summary.pastMonthTrophies} from earlier months
          </span>
        </div>
      </div>
    </Panel>
  );
}

function RecentUnlocks({ items }: { items: AchievementCatalogItem[] }) {
  return (
    <Panel className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-5 py-3">
        <Check aria-hidden="true" size={15} className="text-success" />
        <h2 className="text-sm font-semibold text-text">Recently unlocked</h2>
      </div>
      <div className="grid gap-px bg-border md:grid-cols-3 xl:grid-cols-5">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex min-w-0 items-center gap-3 bg-surface px-4 py-3"
          >
            <AchievementMedal
              notification={{
                id: item.id,
                kind: item.kind,
                title: item.title,
                coverUrl: item.coverUrl,
              }}
              size="sm"
            />
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-text">
                {item.title}
              </div>
              <time
                dateTime={item.milestone!.awardedAt}
                title={new Date(item.milestone!.awardedAt).toLocaleString()}
                className="mt-0.5 block text-[10px] text-text-faint"
              >
                {relativeTime(item.milestone!.awardedAt)}
              </time>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function relativeTime(iso: string) {
  const elapsedSeconds = Math.round((Date.parse(iso) - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(elapsedSeconds) < 60)
    return formatter.format(elapsedSeconds, "second");
  const minutes = Math.round(elapsedSeconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return formatter.format(days, "day");
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return formatter.format(months, "month");
  return formatter.format(Math.round(months / 12), "year");
}
