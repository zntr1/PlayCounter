import { useState } from "react";
import { MoveRight } from "lucide-react";
import { moveGamesToPlayCounter } from "../../../library/moveToPlayCounter";
import { useAppStore, type GameIdentityRef } from "../../../store";
import { formatDuration } from "../../components";
import { Button, Modal } from "../../primitives";

export function MoveToPlayCounterDialog({
  games,
  skippedCount = 0,
  onClose,
  onMoved,
}: {
  games: readonly (GameIdentityRef & {
    name: string;
    totalSeconds: number;
    aliases: GameIdentityRef[];
  })[];
  skippedCount?: number;
  onClose: () => void;
  onMoved?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const showDurationDays = useAppStore(
    (state) => state.settings.showDurationDays,
  );
  const singleGame = games.length === 1 ? games[0] : null;
  const confirm = () => {
    try {
      const moved = moveGamesToPlayCounter(
        games.map((game) => ({ ...game, gameName: game.name })),
      );
      if (moved) {
        useAppStore.getState().addToast({
          tone: "success",
          title:
            moved === 1
              ? "Moved to PlayCounter"
              : `${moved} games moved to PlayCounter`,
          detail: singleGame
            ? `${singleGame.name} is now in PlayCounter. Your playtime and history were kept.`
            : "Your playtime and history were kept for each game.",
        });
      }
      onMoved?.();
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save the move. Please try again.",
      );
    }
  };
  return (
    <Modal
      size="sm"
      labelId="move-to-playcounter-title"
      eyebrow="My Games"
      title={
        singleGame
          ? "Move to PlayCounter?"
          : `Move ${games.length} games to PlayCounter?`
      }
      subtitle={singleGame?.name}
      icon={MoveRight}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={MoveRight}
            disabled={games.length === 0}
            onClick={confirm}
          >
            Move to PlayCounter
          </Button>
        </div>
      }
    >
      {singleGame ? (
        <p className="text-sm leading-6 text-text-muted">
          Keep your {formatDuration(singleGame.totalSeconds, showDurationDays)}{" "}
          of playtime, sessions, notes, playthroughs, and shelves. Future
          sessions add to this total.
        </p>
      ) : (
        <>
          <p className="text-sm leading-6 text-text-muted">
            Keep each game's playtime, sessions, notes, playthroughs, and
            shelves. Future sessions add to each game's total.
          </p>
          <ul
            aria-label="Games to move"
            className="mt-3 max-h-44 overflow-y-auto rounded-lg border border-border bg-bg px-3 divide-y divide-border"
          >
            {games.map((game) => (
              <li
                key={`${game.source}:${game.gameId}`}
                className="flex items-start justify-between gap-3 py-2 text-sm"
              >
                <span className="min-w-0 break-words text-text">
                  {game.name}
                </span>
                <span className="shrink-0 font-mono text-text-muted">
                  {formatDuration(game.totalSeconds, showDurationDays)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {skippedCount > 0 ? (
        <p className="mt-3 text-sm leading-6 text-text-muted">
          {skippedCount} selected {skippedCount === 1 ? "game is" : "games are"}{" "}
          already in PlayCounter and will stay there.
        </p>
      ) : null}
      <p className="mt-3 text-sm leading-6 text-text-muted">
        {singleGame ? "The game moves" : "These games move"} out of all launcher
        tabs into PlayCounter. This only changes your PlayCounter library.
      </p>
      <p className="mt-3 text-sm leading-6 text-text-muted">
        {singleGame
          ? "To associate it with a launcher again, import the game from that launcher."
          : "To associate these games with a launcher again, import them from that launcher."}
      </p>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
