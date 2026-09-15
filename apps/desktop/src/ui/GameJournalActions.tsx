import { BookOpen, FolderHeart, Star, StickyNote } from "lucide-react";
import { GAME_STATUSES, journalNote } from "../personalLibrary";
import { useAppStore, type GameIdentityRef } from "../store";
import { ContextMenuHeading, ContextMenuItem } from "./primitives";
import { STATUS_TONES } from "./journalStyles";
import { useGameJournal } from "./useGameJournal";

export function GameJournalMenu({
  game,
  onClose,
}: {
  game: GameIdentityRef;
  onClose: () => void;
}) {
  const journal = useGameJournal(game);
  const open = useAppStore((s) => s.openGameJournal);
  const update = useAppStore((s) => s.updateGameJournal);
  return (
    <>
      <ContextMenuHeading>My library</ContextMenuHeading>
      <ContextMenuItem
        icon={StickyNote}
        onClick={() => {
          onClose();
          open({ game, tab: "note" });
        }}
      >
        {journalNote(journal) ? "Edit note" : "Add note"}
      </ContextMenuItem>
      <ContextMenuItem
        icon={BookOpen}
        onClick={() => {
          onClose();
          open({ game, tab: "playthroughs" });
        }}
      >
        Playthroughs
        {journal.playthroughs.length ? ` · ${journal.playthroughs.length}` : ""}
      </ContextMenuItem>
      <ContextMenuItem
        icon={Star}
        onClick={() => {
          onClose();
          update(game, { favorite: !journal.favorite });
        }}
      >
        {journal.favorite ? "Remove from Favorites" : "Add to Favorites"}
      </ContextMenuItem>
      <ContextMenuItem
        icon={FolderHeart}
        onClick={() => {
          onClose();
          open({ game, tab: "organize" });
        }}
      >
        Shelves & status
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
  const journal = useGameJournal(game);
  const open = useAppStore((s) => s.openGameJournal);
  const showStatus = useAppStore(
    (s) => s.settings.libraryShowStatusBadges !== false,
  );
  const showNotes = useAppStore(
    (s) => s.settings.libraryShowNoteBadges !== false,
  );
  const status = showStatus ? journal.status : null;
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
          aria-label={`Read note for ${game.gameName ?? "game"}`}
          title="Read note"
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
          aria-label="Favorite"
          title="Favorite"
          className={`${badgeShell} text-amber-300 ${compact ? "h-6 w-6" : ""}`}
        >
          <Star size={compact ? 11 : 13} fill="currentColor" />
        </span>
      ) : null}
      {status ? (
        compact ? (
          <span
            aria-label={GAME_STATUSES[status]}
            title={GAME_STATUSES[status]}
            className={`${badgeShell} h-6 w-6`}
          >
            <span
              className={`h-2 w-2 rounded-full ${STATUS_TONES[status].dot}`}
            />
          </span>
        ) : (
          <span
            title={GAME_STATUSES[status]}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-black/75 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white shadow-md"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${STATUS_TONES[status].dot}`}
            />
            {GAME_STATUSES[status]}
          </span>
        )
      ) : null}
    </div>
  );
}
