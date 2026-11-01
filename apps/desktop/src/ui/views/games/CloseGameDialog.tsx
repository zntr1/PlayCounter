import { Loader2, Square } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { selectControllerItem } from "../../../controllerBridge";
import { getT } from "../../../i18n";
import type { ActiveSession } from "../../../store";
import { closeRunningGame, type CloseGameOutcome } from "../../../tracker";
import { Button, Modal } from "../../primitives";

const t = getT("myGames");

type Step =
  | { kind: "confirm" }
  | { kind: "closing"; index: number }
  | { kind: "stillRunning"; index: number }
  | { kind: "blocked"; index: number };

/** Closes running games from My Games, one after the other: first like their
 *  ✕, then by force if one is still running. With `nextGameName`, it is the
 *  "Close A and start B?" question and `onStart` starts B. The safe button
 *  has the focus at every step, so a stray A / Cross closes nothing. */
export function CloseGameDialog({
  sessions,
  nextGameName,
  onStart,
  onClose,
}: {
  sessions: ActiveSession[];
  nextGameName?: string;
  onStart?: () => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>({ kind: "confirm" });
  const footerRef = useRef<HTMLDivElement>(null);
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    selectControllerItem(
      footerRef.current?.querySelector<HTMLElement>("[data-autofocus]"),
    );
  }, [step.kind]);

  async function closeFrom(index: number, force: boolean) {
    for (let current = index; current < sessions.length; current += 1) {
      setStep({ kind: "closing", index: current });
      let outcome: CloseGameOutcome;
      try {
        outcome = await closeRunningGame(
          sessions[current].id,
          force && current === index,
        );
      } catch (error) {
        console.warn("close game failed", error);
        outcome = "blocked";
      }
      if (!open.current) return;
      if (outcome !== "closed") {
        setStep({ kind: outcome, index: current });
        return;
      }
    }
    onClose();
    onStart?.();
  }

  const session = step.kind === "confirm" ? sessions[0] : sessions[step.index];
  const gameName = session.gameName;
  const dialogButton = { "data-controller-item": "dialog-action" };

  let title: string;
  let body: string[];
  let buttons: ReactNode;
  if (step.kind === "confirm" && nextGameName) {
    title =
      sessions.length === 1
        ? t("{{gameName}} is running", { gameName })
        : t("{{count}} games are running", { count: sessions.length });
    body = [
      sessions.length === 1
        ? t("Stop it first, or start {{nextGameName}} alongside it.", {
            nextGameName,
          })
        : t("Stop them first, or start {{nextGameName}} alongside them.", {
            nextGameName,
          }),
    ];
    buttons = (
      <>
        <Button
          {...dialogButton}
          variant="danger"
          onClick={() => void closeFrom(0, false)}
        >
          {sessions.length === 1
            ? t("Stop {{gameName}} and start {{nextGameName}}", {
                gameName,
                nextGameName,
              })
            : t("Stop {{count}} games and start {{nextGameName}}", {
                count: sessions.length,
                nextGameName,
              })}
        </Button>
        <Button
          {...dialogButton}
          variant="secondary"
          onClick={() => {
            onClose();
            onStart?.();
          }}
        >
          {t("Start {{nextGameName}} anyway", { nextGameName })}
        </Button>
        <Button
          {...dialogButton}
          variant="ghost"
          data-autofocus
          onClick={onClose}
        >
          {t("Cancel")}
        </Button>
      </>
    );
  } else if (step.kind === "confirm") {
    title = t("Stop {{gameName}}?", { gameName });
    body = [
      t(
        "PlayCounter asks the game to close, like clicking its ✕. Save first if the game doesn't save when it closes.",
      ),
    ];
    if (session.emulator) {
      body.push(
        t("This closes {{emulator}}.", { emulator: session.emulator.label }),
      );
    }
    buttons = (
      <>
        <Button
          {...dialogButton}
          variant="danger"
          onClick={() => void closeFrom(0, false)}
        >
          {t("Stop game")}
        </Button>
        <Button
          {...dialogButton}
          variant="ghost"
          data-autofocus
          onClick={onClose}
        >
          {t("Cancel")}
        </Button>
      </>
    );
  } else if (step.kind === "closing") {
    title = t("Stopping {{gameName}}…", { gameName });
    body = [t("Waiting for the game to close.")];
    buttons = (
      <Button
        {...dialogButton}
        variant="ghost"
        data-autofocus
        onClick={onClose}
      >
        {t("Cancel")}
      </Button>
    );
  } else if (step.kind === "stillRunning") {
    title = t("{{gameName}} is still running", { gameName });
    body = [t("Force stop ends it right away. Unsaved progress is lost.")];
    buttons = (
      <>
        <Button
          {...dialogButton}
          variant="danger"
          onClick={() => void closeFrom(step.index, true)}
        >
          {t("Force stop")}
        </Button>
        <Button
          {...dialogButton}
          variant="ghost"
          data-autofocus
          onClick={onClose}
        >
          {t("Cancel")}
        </Button>
      </>
    );
  } else {
    title = t("PlayCounter can't stop {{gameName}}", { gameName });
    body = [
      t(
        "It may run as administrator or be protected by anti-cheat. Close it in the game.",
      ),
    ];
    buttons = (
      <Button
        {...dialogButton}
        variant="primary"
        data-autofocus
        onClick={onClose}
      >
        {t("OK")}
      </Button>
    );
  }

  return (
    <Modal
      size="sm"
      labelId="close-game-dialog-title"
      eyebrow={t("My Games")}
      title={title}
      icon={step.kind === "closing" ? Loader2 : Square}
      iconSpin={step.kind === "closing"}
      onClose={onClose}
      footer={
        // One full-width row per button: the labels are long in some languages.
        <div ref={footerRef} className="grid gap-2">
          {buttons}
        </div>
      }
    >
      {body.map((paragraph, index) => (
        <p
          key={paragraph}
          className={
            index === 0
              ? "text-sm leading-6 text-text-muted"
              : "mt-2 text-sm leading-6 text-text-muted"
          }
        >
          {paragraph}
        </p>
      ))}
    </Modal>
  );
}
