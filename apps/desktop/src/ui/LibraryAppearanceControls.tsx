import clsx from "clsx";
import {
  Grid2X2,
  LayoutGrid,
  List,
  PanelTop,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import { forwardRef, type CSSProperties, type ReactNode } from "react";
import type { MyGamesCardSize } from "./myGamesPresentation";
import { useLibraryPractice } from "./PersonalLibraryContext";
import { IconButton, Switch } from "./primitives";
import { getT } from "../i18n";

const t = getT("myGames");

/* Building blocks for the Customize popover in My Games, shared with the
   practice library in the tour. Every option stays a real checkbox with a
   stable id: tests, the tour anchors and the controller navigation address
   them by id and `data-controller-item`, so only the styling is a switch. */

/** Standard, Large and List: the buttons beside Customize. */
export function LibraryViewButtons({
  view,
  onChange,
}: {
  view: MyGamesCardSize;
  onChange: (size: MyGamesCardSize) => void;
}) {
  const buttons = [
    {
      size: "grid",
      label: t("Grid view"),
      title: t("Standard cards"),
      icon: LayoutGrid,
      iconSize: 15,
    },
    {
      size: "large",
      label: t("Large card view"),
      title: t("Large cards"),
      icon: Grid2X2,
      iconSize: 16,
    },
    {
      size: "list",
      label: t("List view"),
      title: t("List"),
      icon: List,
      iconSize: 15,
    },
  ] as const;
  return (
    <div className="flex h-9 items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5">
      {buttons.map(({ size, label, title, icon: Icon, iconSize }) => (
        <button
          key={size}
          type="button"
          aria-label={label}
          aria-pressed={view === size}
          title={title}
          onClick={() => onChange(size)}
          className={clsx(
            "grid h-full w-8 place-items-center rounded-md transition",
            view === size
              ? "bg-accent text-accent-fg"
              : "text-text-muted hover:bg-surface-hover hover:text-text",
          )}
        >
          <Icon size={iconSize} />
        </button>
      ))}
    </div>
  );
}

/** The gear that opens Customize. `panelId` is the popover it controls. */
export const LibraryCustomizeButton = forwardRef<
  HTMLButtonElement,
  { open: boolean; panelId: string; dataTour?: string; onClick: () => void }
>(function LibraryCustomizeButton({ open, panelId, dataTour, onClick }, ref) {
  return (
    <IconButton
      ref={ref}
      data-tour={dataTour}
      icon={Settings2}
      aria-label={t("Customize library view")}
      title={t("Customize")}
      aria-haspopup="true"
      aria-expanded={open}
      aria-controls={panelId}
      data-controller-item="library-customize"
      onClick={onClick}
      className="h-9 w-9 rounded-lg"
    />
  );
});

/** The Customize popover: its heading, then the groups. */
export function LibraryCustomizePanel({
  id,
  dataTour,
  children,
}: {
  id: string;
  dataTour?: string;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      data-tour={dataTour}
      role="group"
      aria-label={t("Customize library view")}
      className="w-[400px] max-w-[calc(100vw-2rem)]"
    >
      <header className="flex items-center gap-3 border-b border-border px-4 pb-3 pt-3.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-accent/20 bg-accent-tint text-accent-ink">
          <Settings2 size={18} />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-text">
            {t("Customize Library")}
          </h2>
          <p className="text-xs text-text-faint">
            {t("Adjust how your library looks and behaves.")}
          </p>
        </div>
      </header>
      <div className="grid gap-3 p-3">{children}</div>
    </div>
  );
}

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
      <Switch
        data-tour={dataTour}
        id={id}
        checked={checked}
        disabled={disabled}
        aria-describedby={`${id}-help`}
        data-controller-item="library-option"
        onChange={(event) => onChange(event.target.checked)}
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
  showTiers?: boolean;
  showTrackingWarnings: boolean;
  setMyGamesShowOriginBadges: (value: boolean) => void;
  setMyGamesShowMatchBadges: (value: boolean) => void;
  setMyGamesShowStatusBadges: (value: boolean) => void;
  setMyGamesShowNoteBadges: (value: boolean) => void;
  setMyGamesShowTierBadges?: (value: boolean) => void;
  setMyGamesShowTrackingWarnings: (value: boolean) => void;
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
  const rangeProgress =
    gridLayout.maxColumns > 1
      ? Math.max(
          0,
          Math.min(
            100,
            ((gridLayout.sliderValue - 1) / (gridLayout.maxColumns - 1)) * 100,
          ),
        )
      : 0;
  return (
    <>
      <OptionRow
        id={fieldId("show-shelves")}
        label={t("Shelves")}
        help={t("The All games, Favorites and shelf row above the library.")}
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
                {t("Cards per row")}
              </label>
              <p
                id={fieldId("grid-columns-help")}
                className="text-xs leading-4 text-text-faint"
              >
                {gridLayout.columns < gridLayout.sliderValue
                  ? t("Showing {{columns}} per row to fit this window.", {
                      columns: gridLayout.columns,
                    })
                  : t("Kept until you pick Standard or Large cards again.")}
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
            aria-valuetext={t("{{sliderValue}} cards per row", {
              sliderValue: gridLayout.sliderValue,
            })}
            onChange={(event) =>
              setMyGamesGridColumns(event.currentTarget.valueAsNumber)
            }
            className="pc-range mt-2 w-full"
            style={
              {
                "--range-progress": `${rangeProgress}%`,
              } as CSSProperties
            }
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
  showTiers,
  showTrackingWarnings,
  setMyGamesShowOriginBadges,
  setMyGamesShowMatchBadges,
  setMyGamesShowStatusBadges,
  setMyGamesShowNoteBadges,
  setMyGamesShowTierBadges,
  setMyGamesShowTrackingWarnings,
}: CardProps) {
  const { practice, fieldId } = useFieldId();
  return (
    <>
      <OptionRow
        id={fieldId("show-origin")}
        label={t("Source badges")}
        help={t(
          "The Steam, Xbox, emulator or PlayCounter mark beside the name.",
        )}
        checked={showOrigin}
        onChange={setMyGamesShowOriginBadges}
      />
      <OptionRow
        id={fieldId("show-match")}
        label={t("File match info")}
        help={t("The IGDB, Community or Custom seal in the cover corner.")}
        checked={showMatch}
        onChange={setMyGamesShowMatchBadges}
      />
      <OptionRow
        id={fieldId("show-status")}
        label={t("Status on cards")}
        help={t("In progress, Finished and other statuses on the cover.")}
        checked={showStatus}
        dataTour={practice ? "demo-show-status" : undefined}
        onChange={setMyGamesShowStatusBadges}
      />
      <OptionRow
        id={fieldId("show-notes")}
        label={t("Notes on cards")}
        help={t("A note icon on every game that has a note.")}
        checked={showNotes}
        dataTour={practice ? "demo-show-notes" : undefined}
        onChange={setMyGamesShowNoteBadges}
      />
      {setMyGamesShowTierBadges ? (
        <OptionRow
          id={fieldId("show-tiers")}
          label={t("Tiers on cards")}
          help={t("Your tier, S to F, on every game you rated.")}
          checked={showTiers !== false}
          onChange={setMyGamesShowTierBadges}
        />
      ) : null}
      <OptionRow
        id={fieldId("show-tracking-warnings")}
        label={t("Tracking warnings")}
        help={t("The warning sign on games with no known .exe yet.")}
        checked={showTrackingWarnings}
        onChange={setMyGamesShowTrackingWarnings}
      />
    </>
  );
}

/** The "Layout" group. My Games puts its own rows around the two rows every
 *  library has (LibraryLayoutControls). */
export function LibraryLayoutSection({ children }: { children: ReactNode }) {
  return (
    <CustomizeSection
      icon={PanelTop}
      title={t("Layout")}
      hint={t("The main structure of your library.")}
    >
      {children}
    </CustomizeSection>
  );
}

/** The "Card details" group. */
export function LibraryCardSection(props: CardProps) {
  return (
    <CustomizeSection
      icon={LayoutGrid}
      title={t("Card details")}
      hint={t("What each game card shows.")}
    >
      <LibraryCardControls {...props} />
    </CustomizeSection>
  );
}
