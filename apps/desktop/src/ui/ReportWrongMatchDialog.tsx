import {
  AppWindow,
  ArrowLeft,
  Ban,
  ChevronRight,
  CircleHelp,
  EyeOff,
  Flag,
  ArrowLeftRight,
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

type Choice = "not-a-game" | "not-playing" | "app";

// What each ignoring choice does, shown before it runs. Both are undone
// from Discovered, where ignored files can be restored.
const confirmCopy: Record<
  Exclude<Choice, "app">,
  { title: string; points: string[]; action: string }
> = {
  "not-a-game": {
    title: "Ignore and report this file?",
    points: [
      "PlayCounter stops tracking it and ignores it on this PC.",
      "An anonymous report goes to community review.",
      "You can restore it anytime in Discovered.",
    ],
    action: "Ignore and report",
  },
  "not-playing": {
    title: "Ignore this file on this PC?",
    points: [
      "PlayCounter stops tracking it and ignores it on this PC.",
      "Nothing is reported.",
      "You can restore it anytime in Discovered.",
    ],
    action: "Ignore on this PC",
  },
};

// "It's an app, ignore it": reported as software, not as "not a game".
function ignoreAppCopy(isOffline: boolean) {
  return {
    title: "Ignore this app?",
    points: [
      "PlayCounter stops tracking it on this PC.",
      isOffline
        ? "Nothing is reported."
        : "It's reported to community review as software, not as a game. The name is taken from the file.",
      "You can restore it anytime in Discovered.",
    ],
    action: "Ignore app",
  };
}

// Game.exe and co.: only this folder is ignored, and nothing is ever reported.
function genericFolderCopy(exeName: string) {
  return {
    title: "Ignore this folder's file on this PC?",
    points: [
      `PlayCounter stops tracking ${exeName} in this game's folder.`,
      `Other games with their own ${exeName} stay tracked.`,
      "Nothing is reported.",
      "You can restore it anytime in Discovered.",
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
  onDifferentGame: (exeName: string) => void;
  onNotAGame: (exeName: string) => void;
  /** Only offered while the file is running, e.g. in Now Playing. */
  onNotPlaying?: (exeName: string) => void;
  /** "It's an app, count its time": counted on the Software page, time
   *  included. */
  onSoftware?: (exeName: string) => void;
  /** "It's an app, ignore it": software, ignored on this PC. */
  onIgnoreApp?: (exeName: string) => void;
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
    : exeName || "this app";
  const copy =
    picking || !confirming
      ? null
      : isGenericExeName(exeName)
        ? genericFolderCopy(exeName)
        : confirming === "app"
          ? ignoreAppCopy(isOffline)
          : confirmCopy[confirming];
  const confirmAction =
    confirming === "not-a-game"
      ? onNotAGame
      : confirming === "app"
        ? onIgnoreApp
        : onNotPlaying;

  function back() {
    setLastChoice(confirming);
    setConfirming(null);
  }

  return (
    <Modal
      dataTour={demo ? "demo-report-dialog" : undefined}
      backdropDataTour={demo ? "demo-library-modal" : undefined}
      size="md"
      labelId="wrong-match-dialog-title"
      eyebrow="Report wrong match"
      title={gameName || "Wrong match"}
      subtitle={picking ? undefined : label}
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
              Back
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
              Other file
            </Button>
          </div>
        ) : undefined
      }
    >
      {demo ? (
        <p className="mb-3 text-xs text-text-muted">
          Practice only · no report will be submitted.
        </p>
      ) : null}
      {picking && files ? (
        <div>
          <h3 className="text-sm font-semibold text-text">
            Which file is wrong?
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
      ) : (
        <div>
          <h3 className="text-sm font-semibold text-text">
            What&apos;s wrong with this match?
          </h3>
          <div className="mt-3 grid gap-2">
            <ChoiceCard
              icon={ArrowLeftRight}
              title="It's a different game"
              description="Pick the right game for this file."
              onClick={() => onDifferentGame(exeName)}
            />
            {/* Software is counted per file name; Game.exe would turn every
                game in its folders into software. */}
            {onSoftware && !isGenericExeName(exeName) ? (
              <ChoiceCard
                icon={AppWindow}
                title="It's an app, count its time"
                description="Discord, VS Code, a launcher. Its time moves to the Software page."
                onClick={() => onSoftware(exeName)}
              />
            ) : null}
            {onIgnoreApp && !isGenericExeName(exeName) ? (
              <ChoiceCard
                icon={EyeOff}
                title="It's an app, ignore it"
                description="An app you don't want counted. Ignored on this PC."
                autoFocus={lastChoice === "app"}
                onClick={() => setConfirming("app")}
              />
            ) : null}
            <ChoiceCard
              icon={Ban}
              title="It's part of a game, not the game"
              description="A crash reporter, anti-cheat, installer or updater. Ignored and reported."
              autoFocus={lastChoice === "not-a-game"}
              onClick={() => setConfirming("not-a-game")}
            />
            {onNotPlaying ? (
              <ChoiceCard
                icon={CircleHelp}
                title="Not sure, just ignore it"
                description="Ignored on this PC. Nothing is reported."
                autoFocus={lastChoice === "not-playing"}
                onClick={() => setConfirming("not-playing")}
              />
            ) : null}
          </div>
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
