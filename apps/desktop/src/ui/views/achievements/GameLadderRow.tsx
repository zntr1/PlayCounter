import { Gamepad2 } from "lucide-react";
import { useState } from "react";
import { LadderRow } from "./LadderRow";
import type { GameLadder } from "./achievementCatalog";

export function GameLadderRow({ ladder }: { ladder: GameLadder }) {
  const [failedCover, setFailedCover] = useState(false);
  const earned = ladder.rungs.filter((rung) => rung.milestone).length;

  return (
    <LadderRow
      title={ladder.name}
      subtitle={
        ladder.hours === undefined
          ? `${earned} ${earned === 1 ? "trophy" : "trophies"}`
          : `${ladder.hours.toLocaleString(undefined, { maximumFractionDigits: 1 })}h played`
      }
      rungs={ladder.rungs}
      leading={
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
      }
    />
  );
}
