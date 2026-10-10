import type { Game } from "@playcounter/shared";
import { open } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import {
  ArrowLeft,
  FileCode2,
  FolderSearch,
  Plus,
  Search,
  X,
} from "lucide-react";
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
import { Trans } from "react-i18next";
import { getT } from "../i18n";

const t = getT("dialogs");

/* "Add game" in My Games ─────────────────────────────────────────────────────
   Search a game by name, optionally pick its .exe so Play works right away.
   A file the server knows as another game asks first; an unknown file is
   shared for review like a launcher import, or kept on this PC. The files the
   server knows for the game join the picked one (docs/manual-add-plan.md).
   "Set launch file" on a card without a known .exe runs the same file check
   for that card's game, without the search. */

type Step =
  | { kind: "pick" }
  | { kind: "other"; file: GameFile; game: Game }
  | { kind: "share"; file: GameFile };

export function AddGameDialog({
  libraryIgdbIds,
  forGame,
  onClose,
}: {
  /** Games already in My Games, so adding one again without a file is refused. */
  libraryIgdbIds?: ReadonlySet<number>;
  /** A game in My Games without a known .exe ("Set launch file"): no search,
   *  and a file is required. */
  forGame?: GameMetadata;
  onClose: () => void;
}) {
  const apiEndpoint = useAppStore((state) => state.settings.apiEndpoint);
  const addToast = useAppStore((state) => state.addToast);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GameMetadata[]>([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<GameMetadata | null>(
    forGame ?? null,
  );
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileError, setFileError] = useState("");
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [busy, setBusy] = useState(false);
  const searchController = useRef<AbortController | null>(null);

  useEffect(() => () => searchController.current?.abort(), []);

  const alreadyInLibrary =
    !forGame &&
    selected?.igdbId !== undefined &&
    Boolean(libraryIgdbIds?.has(selected.igdbId));

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
          : t(
              "No matching games found. Try the English title or another spelling.",
            ),
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
      title:
        forGame?.name === name
          ? t("Launch file set for {{name}}", { name })
          : `${name} added`,
      detail: file
        ? t("Play starts {{exeName}}.", { exeName: file.exeName })
        : t("It's in My Games now. Log past playtime from its card."),
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
        else
          setMessage(
            t("{{name}} is already in your library.", { name: selected.name }),
          );
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      const check = await checkGameFile(filePath, selected);
      switch (check.kind) {
        case "invalid":
          setFileError(t("Pick an .exe file."));
          return;
        case "ignored":
          setFileError(
            t(
              "{{exeName}} is on PlayCounter's ignore list, so it cannot be the game file.",
              { exeName: check.file.exeName },
            ),
          );
          return;
        case "software":
          setFileError(
            t(
              "{{exeName}} is {{name}}. PlayCounter counts it as software, not as a game.",
              { exeName: check.file.exeName, name: check.name },
            ),
          );
          return;
        case "taken":
          setFileError(
            t("{{exeName}} already counts for {{name}}.", {
              exeName: check.file.exeName,
              name: check.game.name,
            }),
          );
          return;
        case "same":
          linkGameFileByHand(check.file, check.game, "play");
          await done(selected, check.file);
          return;
        case "link":
          // No server entry for this game: the pick is the user's own.
          if (check.game) linkGameFileByHand(check.file, check.game, "link");
          else linkGameFileByHand(check.file, selected, "custom");
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

  /** "Use Payload", or the user's own pick kept on this PC: nothing is sent.
   *  A Custom game can still be shared later from its card. */
  async function linkTo(
    file: GameFile,
    game: Game,
    how: "link" | "custom",
    declined?: Game,
  ) {
    if (busy) return;
    setBusy(true);
    try {
      linkGameFileByHand(file, game, how, declined);
      await done(game, file);
    } finally {
      setBusy(false);
    }
  }

  async function share(file: GameFile, declined?: Game) {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const outcome = await addAndShareGameFile(file, selected, declined);
      await linkServerKnownFiles(selected);
      if (outcome?.kind === "submitted") {
        addToast({
          tone: "success",
          title: t("{{name}} added and shared", { name: selected.name }),
          detail: t(
            "{{exeName}} is waiting for community review. Play starts it.",
            { exeName: file.exeName },
          ),
        });
      } else if (outcome?.kind === "rejected") {
        addToast({
          tone: "info",
          title: t("{{name}} added", { name: selected.name }),
          detail: t(
            "{{exeName}} was reviewed before and not accepted. It is tracked on this PC.",
            { exeName: file.exeName },
          ),
        });
      } else if (outcome?.kind === "failed") {
        addToast({
          tone: "info",
          title: t("{{name}} added", { name: selected.name }),
          detail: t("Sharing {{exeName}} failed: {{error}}", {
            exeName: file.exeName,
            error: outcome.error,
          }),
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

  const filePart = (
    <div className="grid gap-2 rounded-lg border border-border bg-bg/50 p-3">
      <p className="text-xs font-semibold text-text">
        {forGame ? t("Game file") : t("Game file (optional)")}
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
            aria-label={t("Remove game file")}
            onClick={() => {
              setFilePath(null);
              setFileError("");
            }}
            className="h-7 px-2 text-xs"
          >
            {t("Remove")}
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
            {t("Pick game file…")}
          </Button>
          {forGame ? null : (
            <span className="text-xs text-text-muted">
              {t(
                "Without a file, the game is matched the first time you run it.",
              )}
            </span>
          )}
        </div>
      )}
      {fileError ? (
        <p className="text-xs text-danger" role="alert">
          {fileError}
        </p>
      ) : null}
    </div>
  );

  const footer =
    step.kind === "other" ? (
      <div className="flex justify-end">
        <Button
          variant="ghost"
          icon={ArrowLeft}
          disabled={busy}
          onClick={() => setStep({ kind: "pick" })}
        >
          {t("Back")}
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
          {t("Back")}
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => selected && void linkTo(step.file, selected, "custom")}
        >
          {t("Add on this PC only")}
        </Button>
        <Button
          variant="primary"
          autoFocus
          loading={busy}
          onClick={() => void share(step.file)}
        >
          {t("Add and share")}
        </Button>
      </div>
    ) : (
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t("Cancel")}
        </Button>
        <Button
          variant="primary"
          icon={forGame ? FolderSearch : Plus}
          loading={busy}
          disabled={
            !selected || (forGame || alreadyInLibrary ? !filePath : false)
          }
          onClick={() => void add()}
        >
          {forGame ? t("Set launch file") : t("Add game")}
        </Button>
      </div>
    );

  return (
    <Modal
      size="lg"
      labelId="add-game-dialog-title"
      eyebrow={t("My Games")}
      title={forGame ? t("Set launch file") : t("Add game")}
      subtitle={
        forGame
          ? t(
              "Pick the .exe that starts {{name}}. PlayCounter tracks it too.",
              { name: forGame.name },
            )
          : t("Search the game. Add its .exe so Play works right away.")
      }
      icon={forGame ? FolderSearch : Plus}
      onClose={onClose}
      footer={footer}
    >
      {step.kind === "other" && selected ? (
        <div className="grid gap-4">
          <p className="text-sm leading-6 text-text-muted">
            <Trans
              t={t}
              i18nKey={
                step.game.source === "community"
                  ? "The community knows <file>{{file}}</file> as <game>{{game}}</game>. Which game is it?"
                  : "IGDB knows <file>{{file}}</file> as <game>{{game}}</game>. Which game is it?"
              }
              values={{ file: step.file.exeName, game: step.game.name }}
              components={{
                file: <span className="font-semibold text-text" />,
                game: <span className="font-semibold text-text" />,
              }}
            />
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <GameChoice
              game={selected}
              note={forGame ? t("Your game") : t("Your search")}
            >
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => void share(step.file, step.game)}
                className="w-full"
              >
                {t("Keep {{name}} and share", { name: selected.name })}
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void linkTo(step.file, selected, "custom", step.game)
                }
                className="w-full"
              >
                {t("Keep {{name}} on this PC only", { name: selected.name })}
              </Button>
            </GameChoice>
            <GameChoice
              game={step.game}
              note={
                step.game.source === "community"
                  ? t("Community match for {{file}}", {
                      file: step.file.exeName,
                    })
                  : t("IGDB match for {{file}}", { file: step.file.exeName })
              }
            >
              <Button
                variant="primary"
                autoFocus
                disabled={busy}
                onClick={() => void linkTo(step.file, step.game, "link")}
                className="w-full"
              >
                {t("Use {{name}}", { name: step.game.name })}
              </Button>
            </GameChoice>
          </div>
          <p className="text-xs leading-5 text-text-muted">
            {t(
              "Sharing sends {{exeName}} and {{name}} to community review, without your name. Once approved, anyone who runs {{exeName}} is asked which of the two games it is.",
              { exeName: step.file.exeName, name: selected.name },
            )}
          </p>
        </div>
      ) : step.kind === "share" ? (
        <p className="text-sm leading-6 text-text-muted">
          <Trans
            t={t}
            i18nKey="PlayCounter does not know <file>{{file}}</file> yet. Add and share sends it to community review together with <game>{{game}}</game>. Only the file name and the game name are sent. On this PC only sends nothing."
            values={{ file: step.file.exeName, game: selected?.name ?? "" }}
            components={{
              file: <span className="font-semibold text-text" />,
              game: <span className="font-semibold text-text" />,
            }}
          />
        </p>
      ) : forGame ? (
        <div className="grid gap-4">
          <GameChoice game={forGame} note={t("No .exe known yet")} />
          {filePart}
        </div>
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
              placeholder={t("Search by game title or IGDB ID")}
              aria-label={t("Game title")}
              className="min-w-0 flex-1"
            />
            <Button
              type="submit"
              variant="secondary"
              icon={Search}
              loading={searching}
              disabled={!isSearchableGameQuery(query)}
            >
              {t("Search")}
            </Button>
          </form>

          {results.length > 0 ? (
            <div
              role="listbox"
              aria-label={t("Search results")}
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
                      libraryIgdbIds?.has(game.igdbId)
                        ? ` · ${t("In your library")}`
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

          {filePart}

          {alreadyInLibrary && !filePath ? (
            <p className="text-xs text-text-muted">
              {t(
                "{{name}} is already in your library. Pick its game file to make Play start it.",
                { name: selected?.name },
              )}
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
  children?: ReactNode;
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
      {children ? <div className="grid gap-1.5">{children}</div> : null}
    </div>
  );
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
