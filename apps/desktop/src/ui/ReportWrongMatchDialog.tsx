import {
  AppWindow,
  ArrowLeft,
  Ban,
  ChevronRight,
  CircleHelp,
  EyeOff,
  Flag,
  ArrowLeftRight,
  Unlink,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { isGenericExeName } from "../library/exeCandidates";
import { useIsOffline } from "../store";
import { GameCover } from "./GameCover";
import { Button, Modal } from "./primitives";
import { GameFileList } from "./views/games/GameFileList";
import {
  canReportFile,
  fileRunStatus,
  type GameFile,
} from "./views/games/gameFiles";
import { getT } from "../i18n";

const t = getT("dialogs");

type Choice = "not-a-game" | "not-playing" | "app" | "not-this-game";

// What each ignoring choice does, shown before it runs. Both are undone
// from Discovered, where ignored files can be restored.
function confirmCopy(): Record<
  Exclude<Choice, "app" | "not-this-game">,
  { title: string; points: string[]; action: string }
> {
  return {
    "not-a-game": {
      title: t("Ignore and report this file?"),
      points: [
        t("PlayCounter stops tracking it and ignores it on this PC."),
        t("An anonymous report goes to community review."),
        t("You can restore it anytime in Discovered."),
      ],
      action: "Ignore and report",
    },
    "not-playing": {
      title: t("Ignore this file on this PC?"),
      points: [
        t("PlayCounter stops tracking it and ignores it on this PC."),
        t("Nothing is reported."),
        t("You can restore it anytime in Discovered."),
      ],
      action: "Ignore on this PC",
    },
  };
}

// "It's an app, ignore it": ignored on this PC, never reported.
function ignoreAppCopy() {
  return {
    title: t("Ignore this app?"),
    points: [
      t("PlayCounter stops tracking it on this PC."),
      t("Nothing is reported."),
      t("You can restore it anytime in Discovered."),
    ],
    action: "Ignore app",
  };
}

// "It doesn't belong to <game>": the file leaves this game only. Game.exe and
// co. only leave this game's folders; they, and the user's own files, are
// never reported.
function notThisGameCopy(gameName: string, exeName: string, reported: boolean) {
  const generic = isGenericExeName(exeName);
  return {
    title: t("Remove this file from {{gameName}}?", { gameName }),
    points: [
      generic
        ? t(
            "PlayCounter stops counting {{exeName}} in this game's folder for {{gameName}}.",
            { exeName, gameName },
          )
        : t("PlayCounter stops counting it for {{gameName}} on this PC.", {
            gameName,
          }),
      reported
        ? t(
            "It's reported to community review: this file isn't {{gameName}}'s.",
            { gameName },
          )
        : t("Nothing is reported."),
      t(
        "If it runs, it shows up in Discovered. Linking it to {{gameName}} yourself undoes this.",
        { gameName },
      ),
    ],
    action: "Remove from game",
  };
}

// Game.exe and co.: only this folder is ignored, and nothing is ever reported.
function genericFolderCopy(exeName: string) {
  return {
    title: t("Ignore this folder's file on this PC?"),
    points: [
      t("PlayCounter stops tracking {{exeName}} in this game's folder.", {
        exeName,
      }),
      t("Other games with their own {{exeName}} stay tracked.", { exeName }),
      t("Nothing is reported."),
      t("You can restore it anytime in Discovered."),
    ],
    action: "Ignore this folder",
  };
}

export function ReportWrongMatchDialog({
  exeName,
  gameName,
  coverUrl,
  files,
  onPickFile,
  onCancel,
  onDifferentGame,
  onNotAGame,
  onNotPlaying,
  onSoftware,
  onIgnoreApp,
  onNotThisGame,
  unidentified = false,
  demo = false,
}: {
  /** The file to report. Empty: the user picks one of `files` first. */
  exeName: string;
  gameName: string;
  coverUrl?: string;
  /** The card's database files and how they ran here. With two or more that
   *  can be reported, the user says which one is wrong. */
  files?: readonly GameFile[];
  /** The user picked a file from `files`; the caller passes it back as
   *  `exeName`. */
  onPickFile?: (exeName: string) => void;
  onCancel: () => void;
  /** Every choice names the one file it is about. */
  onDifferentGame?: (exeName: string) => void;
  onNotAGame: (exeName: string) => void;
  /** Only offered while the file is running, e.g. in Now Playing. */
  onNotPlaying?: (exeName: string) => void;
  /** "It's an app, count its time": counted on the Software page, time
   *  included. */
  onSoftware?: (exeName: string) => void;
  /** "It's an app, ignore it": software, ignored on this PC. */
  onIgnoreApp?: (exeName: string) => void;
  /** "It doesn't belong to <game>": the file leaves this game, reported. */
  onNotThisGame?: (exeName: string) => void;
  /** A file with no game yet (Now Playing's unidentified card): only what
   *  the file is, with the same choices and confirm steps. */
  unidentified?: boolean;
  demo?: boolean;
}) {
  const reportable = files?.filter(canReportFile) ?? [];
  const canPickOther = reportable.length > 1 && onPickFile !== undefined;
  const [picking, setPicking] = useState(() => !exeName && canPickOther);
  const [confirming, setConfirming] = useState<Choice | null>(null);
  const [lastChoice, setLastChoice] = useState<Choice | null>(null);
  const isOffline = useIsOffline();
  const exeFacts = files?.find((item) => item.exeName === exeName);
  const label = exeFacts
    ? `${exeName} · ${fileRunStatus(exeFacts)}`
    : exeName || t("this app");
  const game = gameName || t("this game");
  // Only a file IGDB or the community matched is reported. Without `files`
  // (Now Playing) the caller only offers database games.
  const reportsNotThisGame =
    !isOffline &&
    !isGenericExeName(exeName) &&
    (files ? exeFacts !== undefined && canReportFile(exeFacts) : true);
  const copy =
    picking || !confirming
      ? null
      : confirming === "not-this-game"
        ? notThisGameCopy(game, exeName, reportsNotThisGame)
        : isGenericExeName(exeName)
          ? genericFolderCopy(exeName)
          : confirming === "app"
            ? ignoreAppCopy()
            : confirmCopy()[confirming];
  const confirmAction =
    confirming === "not-a-game"
      ? onNotAGame
      : confirming === "app"
        ? onIgnoreApp
        : confirming === "not-this-game"
          ? onNotThisGame
          : onNotPlaying;

  function back() {
    setLastChoice(confirming);
    setConfirming(null);
  }

  // Software is counted per file name; Game.exe would turn every game in its
  // folders into software.
  const generic = isGenericExeName(exeName);
  const appCards = (
    <>
      {onSoftware && !generic ? (
        <ChoiceCard
          icon={AppWindow}
          title={t("It's an app, count its time")}
          description={t(
            "Discord, VS Code, a launcher. Its time moves to the Software page.",
          )}
          onClick={() => onSoftware(exeName)}
        />
      ) : null}
      {onIgnoreApp && !generic ? (
        <ChoiceCard
          icon={EyeOff}
          title={t("It's an app, ignore it")}
          description={t("An app you don't want counted. Ignored on this PC.")}
          autoFocus={lastChoice === "app"}
          onClick={() => setConfirming("app")}
        />
      ) : null}
    </>
  );
  const partOfGameCard = (
    <ChoiceCard
      icon={Ban}
      title={
        unidentified
          ? t("It's part of a game, not the game")
          : t("It's part of the game, not the game")
      }
      description={t(
        "A crash reporter, anti-cheat, installer or updater. Ignored and reported.",
      )}
      autoFocus={lastChoice === "not-a-game"}
      onClick={() => setConfirming("not-a-game")}
    />
  );
  const notSureCard = onNotPlaying ? (
    <ChoiceCard
      icon={CircleHelp}
      title={t("Not sure, just ignore it")}
      description={t("Ignored on this PC. Nothing is reported.")}
      autoFocus={lastChoice === "not-playing"}
      onClick={() => setConfirming("not-playing")}
    />
  ) : null;

  return (
    <Modal
      dataTour={demo ? "demo-report-dialog" : undefined}
      backdropDataTour={demo ? "demo-library-modal" : undefined}
      size="md"
      labelId="wrong-match-dialog-title"
      eyebrow={unidentified ? t("Not a game") : t("Report wrong match")}
      title={unidentified ? exeName : gameName || t("Wrong match")}
      subtitle={picking || unidentified ? undefined : label}
      icon={Flag}
      media={
        coverUrl ? (
          <GameCover
            src={coverUrl}
            alt=""
            className="h-[72px] w-[54px] shrink-0 rounded-lg object-cover shadow-raised ring-1 ring-white/10"
          />
        ) : undefined
      }
      onClose={onCancel}
      footer={
        copy ? (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" icon={ArrowLeft} onClick={back} autoFocus>
              {t("Back")}
            </Button>
            <Button variant="primary" onClick={() => confirmAction?.(exeName)}>
              {copy.action}
            </Button>
          </div>
        ) : !picking && canPickOther ? (
          <div className="flex justify-start">
            <Button
              variant="ghost"
              icon={ArrowLeft}
              onClick={() => setPicking(true)}
            >
              {t("Other file")}
            </Button>
          </div>
        ) : undefined
      }
    >
      {demo ? (
        <p className="mb-3 text-xs text-text-muted">
          {t("Practice only · no report will be submitted.")}
        </p>
      ) : null}
      {picking && files ? (
        <div>
          <h3 className="text-sm font-semibold text-text">
            {t("Which file is wrong?")}
          </h3>
          <div className="mt-3">
            <GameFileList
              files={files}
              canPick={canReportFile}
              onPick={(picked) => {
                onPickFile?.(picked);
                setLastChoice(null);
                setPicking(false);
              }}
            />
          </div>
        </div>
      ) : copy ? (
        <div>
          <h3 className="text-sm font-semibold text-text">{copy.title}</h3>
          <ul className="mt-3 grid gap-2 text-sm leading-6 text-text-muted">
            {copy.points.map((point) => (
              <li key={point} className="flex gap-2.5">
                <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                {point}
              </li>
            ))}
          </ul>
        </div>
      ) : unidentified ? (
        <div>
          <h3 className="text-sm font-semibold text-text">
            {t("What is it?")}
          </h3>
          <div className="mt-3 grid gap-2">
            {appCards}
            {partOfGameCard}
            {notSureCard}
          </div>
        </div>
      ) : (
        <div>
          {/* Two directions: the file is fine and the game is wrong, or the
              game is fine and the file is not one of its game files. */}
          <h3 className="text-sm font-semibold text-text">
            {exeName
              ? t("{{game}} is the wrong match for {{file}}", {
                  game,
                  file: exeName,
                })
              : t("{{game}} is the wrong match for this file", { game })}
          </h3>
          <div className="mt-3 grid gap-2">
            {onDifferentGame ? (
              <ChoiceCard
                icon={ArrowLeftRight}
                title={t("It's a different game")}
                description={t("Pick the right game for this file.")}
                onClick={() => onDifferentGame(exeName)}
              />
            ) : null}
            {appCards}
          </div>
          <h3 className="mt-5 text-sm font-semibold text-text">
            {exeName
              ? t("{{file}} isn't {{game}}'s game file", {
                  file: exeName,
                  game,
                })
              : t("This file isn't {{game}}'s game file", { game })}
          </h3>
          <div className="mt-3 grid gap-2">
            {onNotThisGame ? (
              <ChoiceCard
                icon={Unlink}
                title={t("It doesn't belong to {{game}}", { game })}
                description={
                  reportsNotThisGame
                    ? t(
                        "Not one of its files. Removed from this game and reported.",
                      )
                    : t(
                        "Not one of its files. Removed from this game on this PC.",
                      )
                }
                autoFocus={lastChoice === "not-this-game"}
                onClick={() => setConfirming("not-this-game")}
              />
            ) : null}
            {partOfGameCard}
          </div>
          {notSureCard ? (
            <div className="mt-5 grid gap-2">{notSureCard}</div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

function ChoiceCard({
  icon: Icon,
  title,
  description,
  autoFocus,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  autoFocus?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      autoFocus={autoFocus}
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left transition hover:border-accent/60 hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-hover text-text-muted transition group-hover:text-accent-ink">
        <Icon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-text">{title}</span>
        <span className="block text-xs text-text-muted">{description}</span>
      </span>
      <ChevronRight
        size={16}
        className="shrink-0 text-text-faint transition group-hover:text-accent-ink"
      />
    </button>
  );
}
