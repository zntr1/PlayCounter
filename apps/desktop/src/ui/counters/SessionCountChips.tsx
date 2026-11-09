import type { Session } from "@playcounter/shared";
import { Skull } from "lucide-react";
import {
  DEATHS_COUNTER_ID,
  counterName,
  orderedCounters,
} from "../../counters";
import { getT } from "../../i18n";
import { useGameJournal } from "../useGameJournal";

const t = getT("history");

/** A session's counts on its History row: Deaths as a skull, the others with
 *  their name. Only counters above 0, in the order everywhere. */
export function SessionCountChips({ session }: { session: Session }) {
  if (!session.counts) return null;
  return <Chips session={session} counts={session.counts} />;
}

function Chips({
  session,
  counts,
}: {
  session: Session;
  counts: Record<string, number>;
}) {
  const journal = useGameJournal(session);
  const chips = orderedCounters(journal).filter(
    (counter) => (counts[counter.id] ?? 0) > 0,
  );
  return (
    <>
      {chips.map((counter) => {
        const name = counterName(counter);
        const count = counts[counter.id];
        const plainDeaths =
          counter.id === DEATHS_COUNTER_ID && counter.name === undefined;
        return (
          <span
            key={counter.id}
            title={t("{{counter}} in this session: {{value}}", {
              counter: name,
              value: count,
            })}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-hover px-1.5 py-px text-[11.5px] font-semibold text-text/85"
          >
            {plainDeaths ? (
              <Skull size={12} aria-hidden />
            ) : (
              <span className="max-w-[140px] truncate">{name}</span>
            )}
            <b className="font-mono tabular-nums">{count}</b>
          </span>
        );
      })}
    </>
  );
}
