import {
  usePersonalLibraryState,
  useLibraryPractice,
} from "./PersonalLibraryContext";
import { BookOpen, Star, StickyNote } from "lucide-react";
import { gameStatusLabel } from "../personalLibrary";
import { type GameIdentityRef } from "../store";
import { ContextMenuHeading, ContextMenuItem } from "./primitives";
import { STATUS_TONES } from "./journalStyles";
import { useGameJournal } from "./useGameJournal";
import { getT } from "../i18n";

const t = getT("dialogs");

export function GameJournalMenu({
  game,
  onClose,
  heading = true,
}: {
  game: GameIdentityRef;
  onClose: () => void;
  heading?: boolean;
}) {
  const practice = useLibraryPractice();
  const journal = useGameJournal(game);
  const open = usePersonalLibraryState((s) => s.openGameJournal);
  const update = usePersonalLibraryState((s) => s.updateGameJournal);
  return (
    <>
      {heading ? (
        <ContextMenuHeading>{t("My library")}</ContextMenuHeading>
      ) : null}
      <ContextMenuItem
        dataTour={practice ? "demo-menu-favorite" : undefined}
        icon={Star}
        onClick={() => {
          onClose();
          update(game, { favorite: !journal.favorite });
        }}
      >
        {journal.favorite ? t("Remove from Favorites") : t("Add to Favorites")}
      </ContextMenuItem>
      <ContextMenuItem
        dataTour={practice ? "demo-menu-journal" : undefined}
        icon={BookOpen}
        onClick={() => {
          onClose();
          open({ game, tab: "note" });
        }}
      >
        {t("Journal")}
      </ContextMenuItem>
    </>
  );
}

const badgeShell =
  "grid h-7 w-7 place-items-center rounded-full border border-white/20 bg-black/75 text-white shadow-md";

/** What the journal knows about a game, read from its cover: a note to pick up,
 *  a favorite, and where the game stands. Nothing else earns cover space. */
export function GameJournalBadges({
  game,
  compact = false,
}: {
  game: GameIdentityRef;
  compact?: boolean;
}) {
  const practice = useLibraryPractice();
  const journal = useGameJournal(game);
  const open = usePersonalLibraryState((s) => s.openGameJournal);
  const showStatus = usePersonalLibraryState(
    (s) => s.settings.libraryShowStatusBadges !== false,
  );
  const showNotes = usePersonalLibraryState(
    (s) => s.settings.libraryShowNoteBadges !== false,
  );
  const status = showStatus ? journal.status : null;
  const statusLabel = status
    ? t("Status: {{status}}", { status: gameStatusLabel(status) })
    : undefined;
  const other = journal.playthroughs.find((p) => p.note);
  const hasNote = showNotes && Boolean(journal.note || other);
  const notePlaythroughId =
    journal.playthroughs.find(
      (p) => p.id === journal.activePlaythroughId && p.note,
    )?.id ?? (journal.note ? null : other?.id);
  if (!hasNote && !journal.favorite && !status) return null;
  return (
    <div
      className={`absolute ${compact ? "left-1 top-1" : "bottom-2 left-2"} z-40 flex items-center gap-1`}
    >
      {hasNote ? (
        <button
          type="button"
          aria-label={t("Read note for {{game}}", {
            game: game.gameName ?? t("game"),
          })}
          title={t("Read note")}
          onClick={(event) => {
            event.stopPropagation();
            open({ game, tab: "note", playthroughId: notePlaythroughId });
          }}
          className={`${badgeShell} transition hover:bg-accent hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${compact ? "h-6 w-6" : ""}`}
        >
          <StickyNote size={compact ? 12 : 14} />
        </button>
      ) : null}
      {journal.favorite ? (
        <span
          aria-label={t("Favorite")}
          title={t("Favorite")}
          className={`${badgeShell} text-amber-300 ${compact ? "h-6 w-6" : ""}`}
        >
          <Star size={compact ? 11 : 13} fill="currentColor" />
        </span>
      ) : null}
      {status ? (
        compact ? (
          <span
            aria-label={statusLabel}
            title={statusLabel}
            className={`${badgeShell} h-6 w-6`}
          >
            <span
              className={`h-2 w-2 rounded-full ${STATUS_TONES[status].dot}`}
            />
          </span>
        ) : (
          <span
            aria-label={statusLabel}
            title={statusLabel}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-black/75 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white shadow-md"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${STATUS_TONES[status].dot}`}
            />
            {gameStatusLabel(status)}
          </span>
        )
      ) : null}
    </div>
  );
}
