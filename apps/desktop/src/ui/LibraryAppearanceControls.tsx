import { useLibraryPractice } from "./PersonalLibraryContext";

type AppearanceProps = {
  view: string;
  gridLayout: { columns: number; sliderValue: number; maxColumns: number };
  showShelves: boolean;
  showOrigin: boolean;
  showMatch: boolean;
  showStatus: boolean;
  showNotes: boolean;
  setMyGamesGridColumns: (value: number) => void;
  setMyGamesShowShelves: (value: boolean) => void;
  setMyGamesShowOriginBadges: (value: boolean) => void;
  setMyGamesShowMatchBadges: (value: boolean) => void;
  setMyGamesShowStatusBadges: (value: boolean) => void;
  setMyGamesShowNoteBadges: (value: boolean) => void;
};

export function LibraryAppearanceControls({
  view,
  gridLayout,
  showShelves,
  showOrigin,
  showMatch,
  showStatus,
  showNotes,
  setMyGamesGridColumns,
  setMyGamesShowShelves,
  setMyGamesShowOriginBadges,
  setMyGamesShowMatchBadges,
  setMyGamesShowStatusBadges,
  setMyGamesShowNoteBadges,
}: AppearanceProps) {
  const practice = useLibraryPractice();
  const fieldId = (name: string) => `${practice ? "demo-" : ""}library-${name}`;
  return (
    <>
      {view !== "list" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div>
            <label
              htmlFor={fieldId("grid-columns")}
              className="text-sm font-medium text-text"
            >
              Cards per row
            </label>
            <p
              id={fieldId("grid-columns-help")}
              className="mt-1 text-xs leading-5 text-text-faint"
            >
              Kept until you pick Standard cards or Large cards again.
              {gridLayout.columns < gridLayout.sliderValue
                ? ` Showing ${gridLayout.columns} per row to fit this window.`
                : null}
            </p>
          </div>
          <div className="flex w-full items-center gap-3 sm:w-64">
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
              className="h-5 min-w-0 flex-1 cursor-pointer accent-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
            <output
              htmlFor={fieldId("grid-columns")}
              className="min-w-6 text-right font-mono text-sm font-semibold tabular-nums text-text"
            >
              {gridLayout.sliderValue}
            </output>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div>
          <label
            htmlFor={fieldId("show-shelves")}
            className="text-sm font-medium text-text"
          >
            Show shelves
          </label>
          <p
            id={fieldId("show-shelves-help")}
            className="mt-1 text-xs leading-5 text-text-faint"
          >
            Show the row with All games, Favorites, and your shelves above the
            library. Turning it off only hides the row; your shelves are kept.
          </p>
        </div>
        <input
          data-tour={practice ? "demo-show-shelves" : undefined}
          id={fieldId("show-shelves")}
          type="checkbox"
          checked={showShelves}
          aria-describedby={fieldId("show-shelves-help")}
          data-controller-item="library-option"
          onChange={(event) => setMyGamesShowShelves(event.target.checked)}
          className="h-4 w-4 rounded border-border accent-accent"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div>
          <label
            htmlFor={fieldId("show-origin")}
            className="text-sm font-medium text-text"
          >
            Show where games came from
          </label>
          <p
            id={fieldId("show-origin-help")}
            className="mt-1 text-xs leading-5 text-text-faint"
          >
            The Steam, Xbox, emulator or PlayCounter mark beside each game name.
          </p>
        </div>
        <input
          id={fieldId("show-origin")}
          type="checkbox"
          checked={showOrigin}
          aria-describedby={fieldId("show-origin-help")}
          data-controller-item="library-option"
          onChange={(event) => setMyGamesShowOriginBadges(event.target.checked)}
          className="h-4 w-4 rounded border-border accent-accent"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div>
          <label
            htmlFor={fieldId("show-match")}
            className="text-sm font-medium text-text"
          >
            Show how files were matched
          </label>
          <p
            id={fieldId("show-match-help")}
            className="mt-1 text-xs leading-5 text-text-faint"
          >
            The IGDB, Community or Custom seal in the cover corner. Warnings and
            actions always stay.
          </p>
        </div>
        <input
          id={fieldId("show-match")}
          type="checkbox"
          checked={showMatch}
          aria-describedby={fieldId("show-match-help")}
          data-controller-item="library-option"
          onChange={(event) => setMyGamesShowMatchBadges(event.target.checked)}
          className="h-4 w-4 rounded border-border accent-accent"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div>
          <label
            htmlFor={fieldId("show-status")}
            className="text-sm font-medium text-text"
          >
            Show status on game cards
          </label>
          <p
            id={fieldId("show-status-help")}
            className="mt-1 text-xs leading-5 text-text-faint"
          >
            Show each game's progress status, such as In progress or Finished,
            on its cover.
          </p>
        </div>
        <input
          data-tour={practice ? "demo-show-status" : undefined}
          id={fieldId("show-status")}
          type="checkbox"
          checked={showStatus}
          aria-describedby={fieldId("show-status-help")}
          data-controller-item="library-option"
          onChange={(event) => setMyGamesShowStatusBadges(event.target.checked)}
          className="h-4 w-4 rounded border-border accent-accent"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div>
          <label
            htmlFor={fieldId("show-notes")}
            className="text-sm font-medium text-text"
          >
            Show notes on game cards
          </label>
          <p
            id={fieldId("show-notes-help")}
            className="mt-1 text-xs leading-5 text-text-faint"
          >
            Show a note icon on the cover of every game that has a note. Click
            it to read the note.
          </p>
        </div>
        <input
          data-tour={practice ? "demo-show-notes" : undefined}
          id={fieldId("show-notes")}
          type="checkbox"
          checked={showNotes}
          aria-describedby={fieldId("show-notes-help")}
          data-controller-item="library-option"
          onChange={(event) => setMyGamesShowNoteBadges(event.target.checked)}
          className="h-4 w-4 rounded border-border accent-accent"
        />
      </div>
    </>
  );
}
