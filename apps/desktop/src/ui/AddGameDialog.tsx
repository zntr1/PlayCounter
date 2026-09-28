import type { Game } from "@playcounter/shared";
import { open } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import { ArrowLeft, FileCode2, Plus, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { isSearchableGameQuery } from "../communityMetadataSearch";
import { searchLibraryGames } from "../library/gameLookup";
import {
  addAndShareGameFile,
  addGameWithoutFile,
  checkGameFile,
  type GameFile,
} from "../library/manualAdd";
import { useAppStore, type GameMetadata } from "../store";
import { linkGameFileByHand, linkServerKnownFiles } from "../tracker";
import { GameCover } from "./GameCover";
import { Button, Input, Modal } from "./primitives";

/* "Add game" in My Games ─────────────────────────────────────────────────────
   Search a game by name, optionally pick its .exe so Play works right away.
   A file the server knows as another game asks first; an unknown file is
   shared for review like a launcher import, or kept on this PC. The files the
   server knows for the game join the picked one (docs/manual-add-plan.md). */

type Step =
  | { kind: "pick" }
  | { kind: "other"; file: GameFile; game: Game }
  | { kind: "share"; file: GameFile };

export function AddGameDialog({
  libraryIgdbIds,
  onClose,
}: {
  /** Games already in My Games, so adding one again without a file is refused. */
  libraryIgdbIds: ReadonlySet<number>;
  onClose: () => void;
}) {
  const apiEndpoint = useAppStore((state) => state.settings.apiEndpoint);
  const addToast = useAppStore((state) => state.addToast);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GameMetadata[]>([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<GameMetadata | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileError, setFileError] = useState("");
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [busy, setBusy] = useState(false);
  const searchController = useRef<AbortController | null>(null);

  useEffect(() => () => searchController.current?.abort(), []);

  const alreadyInLibrary =
    selected?.igdbId !== undefined && libraryIgdbIds.has(selected.igdbId);

  async function runSearch() {
    if (!isSearchableGameQuery(query)) return;
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    setSearching(true);
    setMessage("");
    try {
      const games = await searchLibraryGames(apiEndpoint, query, {
        signal: controller.signal,
        mainGamesAndRemastersOnly: false,
      });
      if (controller.signal.aborted) return;
      setResults(games);
      setSelected(games[0] ?? null);
      setMessage(
        games.length > 0
          ? ""
          : "No matching games found. Try the English title or another spelling.",
      );
    } catch (cause) {
      if (controller.signal.aborted) return;
      setResults([]);
      setSelected(null);
      setMessage(formatError(cause));
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }

  async function pickFile() {
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Game file", extensions: ["exe"] }],
    });
    if (typeof path !== "string") return;
    setFilePath(path);
    setFileError("");
  }

  /** The files the server knows for `game` join the picked one, so the card
   *  lists them all, then the dialog closes. */
  async function done(game: Game, file?: GameFile) {
    await linkServerKnownFiles(game);
    finish(game.name, file);
  }

  function finish(name: string, file?: GameFile) {
    addToast({
      tone: "success",
      title: `${name} added`,
      detail: file
        ? `Play starts ${file.exeName}.`
        : "It's in My Games now. Log past playtime from its card.",
    });
    onClose();
  }

  async function add() {
    if (!selected || busy) return;
    setBusy(true);
    setFileError("");
    if (!filePath) {
      try {
        if (addGameWithoutFile(selected)) await done(selected);
        else setMessage(`${selected.name} is already in your library.`);
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      const check = await checkGameFile(filePath, selected);
      switch (check.kind) {
        case "invalid":
          setFileError("Pick an .exe file.");
          return;
        case "ignored":
          setFileError(
            `${check.file.exeName} is on PlayCounter's ignore list, so it cannot be the game file.`,
          );
          return;
        case "software":
          setFileError(
            `${check.file.exeName} is ${check.name}. PlayCounter counts it as software, not as a game.`,
          );
          return;
        case "taken":
          setFileError(
            `${check.file.exeName} already counts for ${check.game.name}.`,
          );
          return;
        case "same":
          linkGameFileByHand(check.file, check.game, "play");
          await done(selected, check.file);
          return;
        case "link":
          // No server entry for this game: the pick is the user's own.
          if (check.game) linkGameFileByHand(check.file, check.game, "link");
          else linkGameFileByHand(check.file, selected, "own");
          await done(selected, check.file);
          return;
        case "other":
          setStep({ kind: "other", file: check.file, game: check.game });
          return;
        case "share":
          setStep({ kind: "share", file: check.file });
          return;
      }
    } catch (cause) {
      setFileError(formatError(cause));
    } finally {
      setBusy(false);
    }
  }

  /** "Use Payload", or the user's own pick kept on this PC: nothing is sent. */
  async function linkTo(file: GameFile, game: Game, how: "link" | "own") {
    if (busy) return;
    setBusy(true);
    try {
      linkGameFileByHand(file, game, how);
      await done(game, file);
    } finally {
      setBusy(false);
    }
  }

  async function share(file: GameFile) {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const outcome = await addAndShareGameFile(file, selected);
      await linkServerKnownFiles(selected);
      if (outcome?.kind === "submitted") {
        addToast({
          tone: "success",
          title: `${selected.name} added and shared`,
          detail: `${file.exeName} is waiting for community review. Play starts it.`,
        });
      } else if (outcome?.kind === "rejected") {
        addToast({
          tone: "info",
          title: `${selected.name} added`,
          detail: `${file.exeName} was reviewed before and not accepted. It is tracked on this PC.`,
        });
      } else if (outcome?.kind === "failed") {
        addToast({
          tone: "info",
          title: `${selected.name} added`,
          detail: `Sharing ${file.exeName} failed: ${outcome.error}`,
        });
      } else {
        finish(selected.name, file);
        return;
      }
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const footer =
    step.kind === "other" ? (
      <div className="flex justify-end">
        <Button
          variant="ghost"
          icon={ArrowLeft}
          disabled={busy}
          onClick={() => setStep({ kind: "pick" })}
        >
          Back
        </Button>
      </div>
    ) : step.kind === "share" ? (
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="ghost"
          icon={ArrowLeft}
          disabled={busy}
          onClick={() => setStep({ kind: "pick" })}
        >
          Back
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => selected && void linkTo(step.file, selected, "own")}
        >
          Add on this PC only
        </Button>
        <Button
          variant="primary"
          autoFocus
          loading={busy}
          onClick={() => void share(step.file)}
        >
          Add and share
        </Button>
      </div>
    ) : (
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          icon={Plus}
          loading={busy}
          disabled={!selected || (alreadyInLibrary && !filePath)}
          onClick={() => void add()}
        >
          Add game
        </Button>
      </div>
    );

  return (
    <Modal
      size="lg"
      labelId="add-game-dialog-title"
      eyebrow="My Games"
      title="Add game"
      subtitle="Search the game. Add its .exe so Play works right away."
      icon={Plus}
      onClose={onClose}
      footer={footer}
    >
      {step.kind === "other" && selected ? (
        <div className="grid gap-4">
          <p className="text-sm leading-6 text-text-muted">
            {step.game.source === "community" ? "The community" : "IGDB"} knows{" "}
            <span className="font-semibold text-text">{step.file.exeName}</span>{" "}
            as <span className="font-semibold text-text">{step.game.name}</span>
            . Which game is it?
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <GameChoice game={selected} note="Your search">
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => void share(step.file)}
                className="w-full"
              >
                Keep {selected.name} and share
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void linkTo(step.file, selected, "own")}
                className="w-full"
              >
                Keep {selected.name} on this PC only
              </Button>
            </GameChoice>
            <GameChoice
              game={step.game}
              note={`${step.game.source === "community" ? "Community" : "IGDB"} match for ${step.file.exeName}`}
            >
              <Button
                variant="primary"
                autoFocus
                disabled={busy}
                onClick={() => void linkTo(step.file, step.game, "link")}
                className="w-full"
              >
                Use {step.game.name}
              </Button>
            </GameChoice>
          </div>
          <p className="text-xs leading-5 text-text-muted">
            Sharing sends {step.file.exeName} and {selected.name} to community
            review, without your name. Once approved, anyone who runs{" "}
            {step.file.exeName} is asked which of the two games it is.
          </p>
        </div>
      ) : step.kind === "share" ? (
        <p className="text-sm leading-6 text-text-muted">
          PlayCounter does not know{" "}
          <span className="font-semibold text-text">{step.file.exeName}</span>{" "}
          yet. Add and share sends it to community review together with{" "}
          <span className="font-semibold text-text">{selected?.name}</span>,
          like in a launcher import. Only the file name and the game are sent,
          without your name. On this PC only sends nothing.
        </p>
      ) : (
        <div className="grid gap-4">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void runSearch();
            }}
          >
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by game title or IGDB ID"
              aria-label="Game title"
              className="min-w-0 flex-1"
            />
            <Button
              type="submit"
              variant="secondary"
              icon={Search}
              loading={searching}
              disabled={!isSearchableGameQuery(query)}
            >
              Search
            </Button>
          </form>

          {results.length > 0 ? (
            <div
              role="listbox"
              aria-label="Search results"
              className="grid max-h-64 gap-1.5 overflow-y-auto pr-1"
            >
              {results.map((game) => (
                <button
                  key={game.igdbId}
                  type="button"
                  role="option"
                  aria-selected={selected?.igdbId === game.igdbId}
                  onClick={() => {
                    setSelected(game);
                    setMessage("");
                  }}
                  className={clsx(
                    "flex items-center gap-3 rounded-lg border px-2.5 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                    selected?.igdbId === game.igdbId
                      ? "border-accent/70 bg-accent-tint"
                      : "border-border bg-surface hover:bg-surface-hover",
                  )}
                >
                  {game.coverUrl ? (
                    <GameCover
                      src={game.coverUrl}
                      alt=""
                      className="h-[54px] w-[40px] shrink-0 rounded-md object-cover"
                    />
                  ) : (
                    <span className="h-[54px] w-[40px] shrink-0 rounded-md bg-surface-hover" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-text">
                      {game.name}
                    </span>
                    <span className="block text-xs text-text-muted">
                      {game.releaseYear ? `${game.releaseYear} · ` : ""}IGDB{" "}
                      {game.igdbId}
                      {game.igdbId !== undefined &&
                      libraryIgdbIds.has(game.igdbId)
                        ? " · In your library"
                        : ""}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {message ? (
            <p className="text-xs text-text-muted" role="status">
              {message}
            </p>
          ) : null}

          <div className="grid gap-2 rounded-lg border border-border bg-bg/50 p-3">
            <p className="text-xs font-semibold text-text">
              Game file (optional)
            </p>
            {filePath ? (
              <div className="flex items-center gap-2">
                <FileCode2 size={16} className="shrink-0 text-text-muted" />
                <span
                  className="min-w-0 flex-1 truncate text-xs text-text"
                  title={filePath}
                >
                  {filePath}
                </span>
                <Button
                  variant="ghost"
                  icon={X}
                  aria-label="Remove game file"
                  onClick={() => {
                    setFilePath(null);
                    setFileError("");
                  }}
                  className="h-7 px-2 text-xs"
                >
                  Remove
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  icon={FileCode2}
                  onClick={() => void pickFile()}
                  className="h-8 text-xs"
                >
                  Pick game file…
                </Button>
                <span className="text-xs text-text-muted">
                  Without a file, the game is matched the first time you run it.
                </span>
              </div>
            )}
            {fileError ? (
              <p className="text-xs text-danger" role="alert">
                {fileError}
              </p>
            ) : null}
          </div>

          {alreadyInLibrary && !filePath ? (
            <p className="text-xs text-text-muted">
              {selected?.name} is already in your library. Pick its game file to
              make Play start it.
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

/** One game on the "which game is it?" step, with its choices below. */
function GameChoice({
  game,
  note,
  children,
}: {
  game: Pick<Game, "name" | "coverUrl" | "releaseYear">;
  note: string;
  children: ReactNode;
}) {
  return (
    <div className="grid content-start gap-3 rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center gap-3">
        {game.coverUrl ? (
          <GameCover
            src={game.coverUrl}
            alt=""
            className="h-[96px] w-[72px] shrink-0 rounded-md object-cover"
          />
        ) : (
          <span className="h-[96px] w-[72px] shrink-0 rounded-md bg-surface-hover" />
        )}
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-text">
            {game.name}
          </span>
          <span className="block text-xs text-text-muted">
            {game.releaseYear ? `${game.releaseYear} · ` : ""}
            {note}
          </span>
        </span>
      </div>
      <div className="grid gap-1.5">{children}</div>
    </div>
  );
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
