import {
  ArrowLeft,
  Ban,
  ChevronRight,
  EyeOff,
  Flag,
  ArrowLeftRight,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { GameCover } from "./GameCover";
import { Button, Modal } from "./primitives";

type Choice = "not-a-game" | "not-playing";

// What each ignoring choice does, shown before it runs. Both are undone
// from Discovered, where ignored files can be restored.
const confirmCopy: Record<
  Choice,
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

export function ReportWrongMatchDialog({
  exeName,
  gameName,
  coverUrl,
  onCancel,
  onDifferentGame,
  onNotAGame,
  onNotPlaying,
  demo = false,
}: {
  exeName: string;
  gameName: string;
  coverUrl?: string;
  onCancel: () => void;
  onDifferentGame: () => void;
  onNotAGame: () => void;
  /** Only offered while the file is running, e.g. in Now Playing. */
  onNotPlaying?: () => void;
  demo?: boolean;
}) {
  const [confirming, setConfirming] = useState<Choice | null>(null);
  const [lastChoice, setLastChoice] = useState<Choice | null>(null);
  const label = exeName || "this app";
  const copy = confirming ? confirmCopy[confirming] : null;

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
      subtitle={label}
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
            <Button
              variant="primary"
              onClick={confirming === "not-a-game" ? onNotAGame : onNotPlaying}
            >
              {copy.action}
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
      {copy ? (
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
              title="It belongs to a different game"
              description="Pick the right game for this file."
              onClick={onDifferentGame}
            />
            <ChoiceCard
              icon={Ban}
              title="It isn't a game at all"
              description="A tool, launcher, or background app."
              autoFocus={lastChoice === "not-a-game"}
              onClick={() => setConfirming("not-a-game")}
            />
            {onNotPlaying ? (
              <ChoiceCard
                icon={EyeOff}
                title="I'm not playing this right now"
                description="Not sure what it is? Ignore it on this PC only."
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
