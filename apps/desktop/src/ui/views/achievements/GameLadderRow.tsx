import { Gamepad2 } from "lucide-react";
import { useState } from "react";
import clsx from "clsx";
import { AchievementMedal } from "../../AchievementBadge";
import { remainderLabel, type GameLadder } from "./achievementCatalog";

export function GameLadderRow({ ladder }: { ladder: GameLadder }) {
  const [failedCover, setFailedCover] = useState(false);
  const earned = ladder.rungs.filter((rung) => rung.milestone).length;

  return (
    <article className="grid min-w-0 grid-cols-[56px_minmax(0,1fr)] items-center gap-4 rounded-xl border border-border bg-bg p-3 transition hover:border-accent/30 xl:grid-cols-[56px_minmax(130px,0.8fr)_minmax(360px,1.8fr)]">
      <div className="h-[72px] w-12 overflow-hidden rounded-lg bg-surface-hover shadow-raised">
        {ladder.coverUrl && !failedCover ? (
          <img
            src={ladder.coverUrl}
            alt=""
            className="h-full w-full object-cover"
            onError={() => setFailedCover(true)}
          />
        ) : (
          <div className="grid h-full place-items-center text-text-faint">
            <Gamepad2 aria-hidden="true" size={22} />
          </div>
        )}
      </div>
      <div className="min-w-0">
        <h3 className="break-words text-sm font-semibold text-text">
          {ladder.name}
        </h3>
        <p className="mt-1 font-mono text-xs tabular-nums text-text-muted">
          {ladder.hours === undefined
            ? `${earned} ${earned === 1 ? "trophy" : "trophies"}`
            : `${ladder.hours.toLocaleString(undefined, { maximumFractionDigits: 1 })}h played`}
        </p>
      </div>
      <div className="col-span-2 grid min-w-0 grid-cols-7 gap-1.5 xl:col-span-1">
        {ladder.rungs.map((rung) => (
          <div
            key={rung.id}
            className={clsx(
              "flex min-w-0 flex-col items-center rounded-lg px-1 py-1.5",
              rung.isNext &&
                !rung.milestone &&
                "bg-accent/10 ring-1 ring-inset ring-accent/40",
            )}
          >
            <AchievementMedal
              notification={{
                id: rung.id,
                kind: rung.kind,
                title: rung.title,
                coverUrl: rung.coverUrl,
              }}
              locked={!rung.milestone}
              size="sm"
            />
            <span className="mt-1 font-mono text-[10px] font-semibold tabular-nums text-text-muted">
              {rung.threshold.toLocaleString()}h
            </span>
            {rung.isNext && !rung.milestone ? (
              <span className="mt-0.5 max-w-full truncate text-[9px] font-semibold text-accent">
                {remainderLabel(rung).replace(" more hours", "h left")}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </article>
  );
}
