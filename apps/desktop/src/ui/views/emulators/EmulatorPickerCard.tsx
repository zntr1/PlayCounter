import type { Game } from "@playcounter/shared";
import { useState } from "react";
import {
  addCustomEmulatorGame,
  dismissEmulatorHostNotice,
  ignoreEmulatorContent,
  searchEmulatorGames,
  selectEmulatorGame,
} from "../../../tracker";
import { useAppStore } from "../../../store";
import type { EmulatorObservation } from "../../../emulators/types";
import { Panel } from "../../components";
import { Button, Input } from "../../primitives";

export function EmulatorPickerCard({
  observation,
}: {
  observation: EmulatorObservation;
}) {
  const addToast = useAppStore((state) => state.addToast);
  const [query, setQuery] = useState(
    observation.kind === "content"
      ? (observation.searchHint ?? observation.display)
      : "",
  );
  const [customName, setCustomName] = useState("");
  const [results, setResults] = useState<Game[]>(
    observation.kind === "content" ? (observation.candidates ?? []) : [],
  );
  const [busy, setBusy] = useState(false);
  const guestPlatformLabel =
    observation.emulatorId === "dolphin" ? "GameCube / Wii" : "DOS";

  if (observation.kind === "host-notice") {
    return (
      <Panel className="border-warning-border p-5">
        <h2 className="font-semibold text-text">
          {observation.label} is running
        </h2>
        <p className="mt-1 text-sm text-text-muted">
          PlayCounter could not identify the game inside it from the available
          process details. Start a game in the emulator or launch one with a
          supported game file or title identifier.
        </p>
        <Button
          className="mt-4"
          variant="ghost"
          onClick={() => dismissEmulatorHostNotice(observation.key)}
        >
          Dismiss
        </Button>
      </Panel>
    );
  }

  async function runSearch() {
    setBusy(true);
    try {
      setResults(await searchEmulatorGames(observation.emulatorId, query));
    } catch (error) {
      addToast({
        tone: "error",
        title: "Game search failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="border-accent/30 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-accent">
            {observation.label} content detected
          </div>
          <h2 className="mt-1 text-xl font-semibold text-text">
            {observation.display}
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            {observation.state === "resolving"
              ? `Looking for a matching ${guestPlatformLabel} game…`
              : observation.endedAt
                ? "The emulator stopped. Choose the game to keep the detected playtime."
                : "Choose the game once; PlayCounter will remember this content locally."}
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={() => void ignoreEmulatorContent(observation.key)}
        >
          Do not track
        </Button>
      </div>

      {results.length > 0 ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {results.map((game) => (
            <button
              key={`${game.source}:${game.id}`}
              type="button"
              onClick={() => void selectEmulatorGame(observation.key, game)}
              className="flex items-center gap-3 rounded-lg border border-border bg-bg p-3 text-left transition hover:border-accent/50 hover:bg-surface-hover"
            >
              {game.coverUrl ? (
                <img
                  src={game.coverUrl}
                  alt=""
                  className="h-16 w-12 shrink-0 rounded object-cover"
                />
              ) : (
                <div className="h-16 w-12 shrink-0 rounded bg-surface-hover" />
              )}
              <span className="min-w-0">
                <span className="block truncate font-medium text-text">
                  {game.name}
                </span>
                <span className="mt-1 block text-xs text-text-faint">
                  {game.releaseYear ? `${game.releaseYear} · ` : ""}
                  {guestPlatformLabel}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void runSearch();
          }}
          placeholder={`Search ${guestPlatformLabel} games`}
          className="min-w-64 flex-1"
        />
        <Button loading={busy} onClick={() => void runSearch()}>
          Search {guestPlatformLabel} games
        </Button>
      </div>
      <p className="mt-2 text-xs text-text-faint">
        Search is restricted to {guestPlatformLabel} and returns up to 50
        results.
      </p>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
        <Input
          value={customName}
          onChange={(event) => setCustomName(event.target.value)}
          placeholder="Or enter a custom game name"
          className="min-w-64 flex-1"
        />
        <Button
          variant="secondary"
          disabled={!customName.trim()}
          onClick={() =>
            void addCustomEmulatorGame(observation.key, customName)
          }
        >
          Add custom game
        </Button>
      </div>
    </Panel>
  );
}
