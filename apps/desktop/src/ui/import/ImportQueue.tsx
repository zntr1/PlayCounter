import clsx from "clsx";
import { Gamepad2, Search } from "lucide-react";
import { memo, useState } from "react";
import { getT } from "../../i18n";
import type { ImportGroupKey } from "../../library/importGroups";
import { GameCover } from "../GameCover";
import { rowFact, type ImportRow } from "./importRows";
import { importGroupHint } from "./ImportShelves";

const t = getT("import");

/** The games of one shelf. Clicking one shows it next to the list. */
export function ImportQueue({
  group,
  rows,
  currentId,
  selected,
  skipped,
  onShow,
  onSelected,
  onSelectAll,
}: {
  group: ImportGroupKey;
  rows: readonly ImportRow[];
  currentId: string | null;
  selected: ReadonlySet<string>;
  skipped: ReadonlySet<string>;
  onShow: (externalId: string) => void;
  onSelected: (externalId: string, checked: boolean) => void;
  onSelectAll: (checked: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const search = query.trim().toLowerCase();
  const shown = search
    ? rows.filter((row) => row.title.toLowerCase().includes(search))
    : rows;
  const checkable = rows.some((row) => row.selectable);
  return (
    <section
      id={`import-panel-${group}`}
      role="tabpanel"
      aria-labelledby={`import-tab-${group}`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && query) {
          event.preventDefault();
          setQuery("");
        }
      }}
      className="overflow-hidden rounded-lg border border-border bg-surface shadow-raised"
    >
      <div className="flex items-center gap-1 px-3 pt-3">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-bg px-3 text-text-faint focus-within:border-accent">
          <Search size={15} aria-hidden="true" className="shrink-0" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Search games")}
            aria-label={t("Search games")}
            className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
          />
        </label>
        {checkable ? (
          <>
            <button
              type="button"
              onClick={() => onSelectAll(true)}
              className="rounded-md px-2 py-1.5 text-sm font-semibold text-text-muted hover:bg-surface-hover hover:text-text"
            >
              {t("Select all")}
            </button>
            <button
              type="button"
              onClick={() => onSelectAll(false)}
              className="rounded-md px-2 py-1.5 text-sm font-semibold text-text-muted hover:bg-surface-hover hover:text-text"
            >
              {t("Select none")}
            </button>
          </>
        ) : null}
      </div>
      <p className="px-4 pb-2 pt-2.5 text-xs leading-5 text-text-muted">
        {importGroupHint(group)}
      </p>
      <div className="max-h-[calc(100vh-24rem)] min-h-[160px] overflow-y-auto px-2 pb-2">
        {shown.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-text-muted">
            {search
              ? t("No game matches “{{search}}”.", { search: query.trim() })
              : t("Nothing here right now.")}
          </p>
        ) : (
          shown.map((row) => {
            const id = row.game.externalId;
            return (
              <QueueRow
                key={id}
                row={row}
                active={id === currentId}
                checked={selected.has(id)}
                skipped={skipped.has(id)}
                onShow={onShow}
                onSelected={onSelected}
              />
            );
          })
        )}
      </div>
    </section>
  );
}

/** One game in the list. Redrawn only when its own row or state changes. */
const QueueRow = memo(function QueueRow({
  row,
  active,
  checked,
  skipped,
  onShow,
  onSelected,
}: {
  row: ImportRow;
  active: boolean;
  checked: boolean;
  skipped: boolean;
  onShow: (externalId: string) => void;
  onSelected: (externalId: string, checked: boolean) => void;
}) {
  const id = row.game.externalId;
  const asks = row.group === "attention" && !skipped;
  return (
    <div
      className={clsx(
        "relative flex min-w-0 items-center gap-2.5 rounded-xl pl-3 pr-2 transition",
        active ? "sidebar-button-active" : "hover:bg-surface-hover",
      )}
    >
      {row.selectable ? (
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onSelected(id, event.target.checked)}
          aria-label={t("Import {{name}}", { name: row.title })}
          className="h-4 w-4 shrink-0 accent-[rgb(var(--color-accent))]"
        />
      ) : (
        <span
          aria-hidden="true"
          className={clsx(
            "h-2 w-2 shrink-0 rounded-full",
            asks ? "bg-accent" : "border border-text-faint",
            "mx-1",
          )}
        />
      )}
      <button
        type="button"
        aria-current={active}
        onClick={() => onShow(id)}
        onDoubleClick={
          row.selectable ? () => onSelected(id, !checked) : undefined
        }
        onKeyDown={(event) => {
          if (event.key !== " " || !row.selectable) return;
          event.preventDefault();
          if (!event.repeat) onSelected(id, !checked);
        }}
        className="flex min-w-0 flex-1 items-center gap-3 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <span
          className={clsx(
            "grid h-10 w-[30px] shrink-0 place-items-center overflow-hidden rounded bg-surface-hover text-text-faint",
            row.group === "unavailable" && "grayscale brightness-50",
          )}
        >
          {row.coverUrl ? (
            <GameCover
              src={row.coverUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <Gamepad2 size={14} aria-hidden="true" />
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-text">
            {row.title}
          </span>
          <span
            className={clsx(
              "block truncate text-xs",
              asks ? "text-accent-ink" : "text-text-muted",
            )}
          >
            {rowFact(row, skipped)}
          </span>
        </span>
      </button>
    </div>
  );
});
