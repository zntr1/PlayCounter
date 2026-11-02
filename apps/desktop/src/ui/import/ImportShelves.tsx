import clsx from "clsx";
import { getT } from "../../i18n";
import {
  IMPORT_GROUP_ORDER,
  type ImportGroupKey,
} from "../../library/importGroups";
import { GameCover } from "../GameCover";
import type { ImportRow } from "./importRows";

const t = getT("import");

export function importGroupLabel(group: ImportGroupKey) {
  switch (group) {
    case "ready":
      return t("Ready to import");
    case "attention":
      return t("Needs you");
    case "imported":
      return t("Already in My Games");
    case "unavailable":
      return t("Can't import");
  }
}

export function importGroupHint(group: ImportGroupKey) {
  switch (group) {
    case "ready":
      return t(
        "Checked games are imported. Games you never played start unchecked.",
      );
    case "attention":
      return t(
        "Say which game it is, or which file starts it. Then import it right here.",
      );
    case "imported":
      return t("Check a game to import it again and update it.");
    case "unavailable":
      return t("Not games, or nothing to import. They stay out of My Games.");
  }
}

/** The four shelves: each shows its covers and count, and filters the list. */
export function ImportShelves({
  groups,
  active,
  onSelect,
}: {
  groups: Record<ImportGroupKey, ImportRow[]>;
  active: ImportGroupKey;
  onSelect: (group: ImportGroupKey) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label={t("Import readiness")}
      className="grid grid-cols-2 gap-3 xl:grid-cols-4"
    >
      {IMPORT_GROUP_ORDER.map((group) => {
        const rows = groups[group];
        const covers = rows.filter((row) => row.coverUrl).slice(0, 3);
        const selected = group === active;
        // Games in My Games with new playtime stand out like "Needs you".
        const updates = rows.filter((row) => row.newPlaytime).length;
        const calls = group === "attention" ? rows.length > 0 : updates > 0;
        return (
          <button
            key={group}
            id={`import-tab-${group}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`import-panel-${group}`}
            onClick={() => onSelect(group)}
            className={clsx(
              "flex min-w-0 items-center gap-4 rounded-2xl border px-4 py-3.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
              selected
                ? "border-accent/70 bg-accent-tint"
                : "border-border bg-surface hover:border-text-faint",
            )}
          >
            <span
              aria-hidden="true"
              className={clsx(
                "flex h-14 shrink-0 pl-4",
                group === "unavailable" && "grayscale brightness-50",
              )}
            >
              {covers.length > 0 ? (
                covers.map((row, index) => (
                  <GameCover
                    key={row.key}
                    src={row.coverUrl!}
                    alt=""
                    className={clsx(
                      "-ml-4 h-14 w-[42px] rounded-md border-2 object-cover shadow-raised",
                      selected ? "border-bg" : "border-surface",
                      index === 0 && "-rotate-6",
                      index === 2 && "rotate-3",
                    )}
                  />
                ))
              ) : (
                <span className="-ml-4 h-14 w-[42px] rounded-md border border-dashed border-border" />
              )}
            </span>
            <span className="min-w-0">
              <span className="flex min-w-0 items-baseline gap-2">
                <span
                  className={clsx(
                    "block text-[28px] font-bold leading-none tabular-nums",
                    calls
                      ? "text-accent-ink"
                      : group === "ready"
                        ? "text-text"
                        : "text-text-muted",
                  )}
                >
                  {rows.length}
                </span>
                {updates > 0 ? (
                  <span className="truncate text-xs font-semibold text-accent-ink">
                    {t("{{count}} updates", { count: updates })}
                  </span>
                ) : null}
              </span>
              <span className="mt-1 block truncate text-sm font-semibold text-text">
                {importGroupLabel(group)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
