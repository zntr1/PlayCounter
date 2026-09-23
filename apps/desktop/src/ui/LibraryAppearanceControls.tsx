import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useLibraryPractice } from "./PersonalLibraryContext";

/* Building blocks for the Customize popover in My Games, shared with the
   practice library in the tour. Every option stays a real checkbox with a
   stable id: tests, the tour anchors and the controller navigation address
   them by id and `data-controller-item`, so only the styling is a switch. */

/** A titled group of options: icon tile, title, one-line hint, then rows. */
export function CustomizeSection({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-bg px-3.5 pb-1 pt-3">
      <header className="mb-1 flex items-center gap-2.5">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-accent/20 bg-accent-tint text-accent-ink">
          <Icon size={15} />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text">{title}</h3>
          <p className="text-[11px] leading-4 text-text-faint">{hint}</p>
        </div>
      </header>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

/** One on/off option: label and a short help line, switch on the right. */
export function OptionRow({
  id,
  label,
  help,
  checked,
  disabled = false,
  dataTour,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  checked: boolean;
  disabled?: boolean;
  dataTour?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <label
          htmlFor={id}
          className={clsx(
            "text-[13px] font-medium",
            disabled ? "text-text-faint" : "text-text",
          )}
        >
          {label}
        </label>
        <p id={`${id}-help`} className="text-xs leading-4 text-text-faint">
          {help}
        </p>
      </div>
      <input
        data-tour={dataTour}
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={`${id}-help`}
        data-controller-item="library-option"
        onChange={(event) => onChange(event.target.checked)}
        className="pc-switch"
      />
    </div>
  );
}

type GridLayout = { columns: number; sliderValue: number; maxColumns: number };

type LayoutProps = {
  view: string;
  gridLayout: GridLayout;
  showShelves: boolean;
  setMyGamesGridColumns: (value: number) => void;
  setMyGamesShowShelves: (value: boolean) => void;
};

type CardProps = {
  showOrigin: boolean;
  showMatch: boolean;
  showStatus: boolean;
  showNotes: boolean;
  setMyGamesShowOriginBadges: (value: boolean) => void;
  setMyGamesShowMatchBadges: (value: boolean) => void;
  setMyGamesShowStatusBadges: (value: boolean) => void;
  setMyGamesShowNoteBadges: (value: boolean) => void;
};

function useFieldId() {
  const practice = useLibraryPractice();
  return {
    practice,
    fieldId: (name: string) => `${practice ? "demo-" : ""}library-${name}`,
  };
}

/** Cards per row and the shelf row. */
export function LibraryLayoutControls({
  view,
  gridLayout,
  showShelves,
  setMyGamesGridColumns,
  setMyGamesShowShelves,
}: LayoutProps) {
  const { practice, fieldId } = useFieldId();
  return (
    <>
      <OptionRow
        id={fieldId("show-shelves")}
        label="Shelves"
        help="The All games, Favorites and shelf row above the library."
        checked={showShelves}
        dataTour={practice ? "demo-show-shelves" : undefined}
        onChange={setMyGamesShowShelves}
      />
      {view !== "list" ? (
        <div className="py-2.5">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <label
                htmlFor={fieldId("grid-columns")}
                className="text-[13px] font-medium text-text"
              >
                Cards per row
              </label>
              <p
                id={fieldId("grid-columns-help")}
                className="text-xs leading-4 text-text-faint"
              >
                {gridLayout.columns < gridLayout.sliderValue
                  ? `Showing ${gridLayout.columns} per row to fit this window.`
                  : "Kept until you pick Standard or Large cards again."}
              </p>
            </div>
            <output
              htmlFor={fieldId("grid-columns")}
              className="min-w-6 text-right font-mono text-sm font-semibold tabular-nums text-text"
            >
              {gridLayout.sliderValue}
            </output>
          </div>
          <input
            data-tour={practice ? "demo-grid-columns" : undefined}
            id={fieldId("grid-columns")}
            type="range"
            min={1}
            max={gridLayout.maxColumns}
            step={1}
            value={gridLayout.sliderValue}
            aria-describedby={fieldId("grid-columns-help")}
            aria-valuetext={`${gridLayout.sliderValue} cards per row`}
            onChange={(event) =>
              setMyGamesGridColumns(event.currentTarget.valueAsNumber)
            }
            className="mt-2 h-5 w-full cursor-pointer accent-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          />
        </div>
      ) : null}
    </>
  );
}

/** What each game card shows on top of its cover. */
export function LibraryCardControls({
  showOrigin,
  showMatch,
  showStatus,
  showNotes,
  setMyGamesShowOriginBadges,
  setMyGamesShowMatchBadges,
  setMyGamesShowStatusBadges,
  setMyGamesShowNoteBadges,
}: CardProps) {
  const { practice, fieldId } = useFieldId();
  return (
    <>
      <OptionRow
        id={fieldId("show-origin")}
        label="Source badges"
        help="The Steam, Xbox, emulator or PlayCounter mark beside the name."
        checked={showOrigin}
        onChange={setMyGamesShowOriginBadges}
      />
      <OptionRow
        id={fieldId("show-match")}
        label="File match info"
        help="The IGDB, Community or Custom seal in the cover corner."
        checked={showMatch}
        onChange={setMyGamesShowMatchBadges}
      />
      <OptionRow
        id={fieldId("show-status")}
        label="Status on cards"
        help="In progress, Finished and other statuses on the cover."
        checked={showStatus}
        dataTour={practice ? "demo-show-status" : undefined}
        onChange={setMyGamesShowStatusBadges}
      />
      <OptionRow
        id={fieldId("show-notes")}
        label="Notes on cards"
        help="A note icon on every game that has a note."
        checked={showNotes}
        dataTour={practice ? "demo-show-notes" : undefined}
        onChange={setMyGamesShowNoteBadges}
      />
    </>
  );
}

/** Both groups in one flat list, for the tour's practice library. */
export function LibraryAppearanceControls(props: LayoutProps & CardProps) {
  return (
    <>
      <LibraryLayoutControls {...props} />
      <LibraryCardControls {...props} />
    </>
  );
}
