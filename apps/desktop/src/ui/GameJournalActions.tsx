import { BookOpen, FolderHeart, Star, StickyNote } from "lucide-react";
import { journalNote } from "../personalLibrary";
import { useAppStore, type GameIdentityRef } from "../store";
import { ContextMenuHeading, ContextMenuItem } from "./primitives";
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

export function GameNoteBadge({
  game,
  compact = false,
}: {
  game: GameIdentityRef;
  compact?: boolean;
}) {
  const journal = useGameJournal(game);
  const open = useAppStore((s) => s.openGameJournal);
  const applicable = journalNote(journal);
  const other = journal.playthroughs.find((p) => p.note);
  const hasNote = Boolean(applicable || other);
  const notePlaythroughId =
    journal.playthroughs.find(
      (p) => p.id === journal.activePlaythroughId && p.note,
    )?.id ?? (journal.note ? null : other?.id);
  if (!hasNote && !journal.favorite) return null;
  return (
    <div
      className={`absolute ${compact ? "left-1 top-1" : "bottom-2 left-2"} z-40 flex gap-1`}
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
          className="grid h-7 w-7 place-items-center rounded-full border border-white/20 bg-black/75 text-white shadow-md transition hover:bg-accent hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <StickyNote size={14} />
        </button>
      ) : null}
      {journal.favorite && !compact ? (
        <span
          aria-label="Favorite"
          title="Favorite"
          className="grid h-7 w-7 place-items-center rounded-full border border-white/20 bg-black/75 text-amber-300"
        >
          <Star size={13} fill="currentColor" />
        </span>
      ) : null}
    </div>
  );
}
