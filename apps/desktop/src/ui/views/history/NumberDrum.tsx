import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

const pad = (value: number) => String(value).padStart(2, "0");

/* One number of a time or a length, as a small drum: the value in the
   middle, the next one above and the previous one below. The mouse wheel,
   the arrow keys or a click on a neighbour step it; typing sets it. The
   parent decides what a step means, so 23:59 + 1 minute can roll over into
   the next day. */
export function NumberDrum({
  value,
  labelledBy,
  caption,
  cycle,
  digits = 2,
  dimmed = false,
  autoFocus = false,
  canStep = () => true,
  onStep,
  onSet,
}: {
  value: number;
  /** Ids of the elements that name this number, e.g. "Started" + "Hours". */
  labelledBy: string;
  /** Shown small under the drum, e.g. "Hours". */
  caption: string;
  /** 24 for hours, 60 for minutes: the neighbours wrap around. */
  cycle?: number;
  /** How many digits typing may enter. */
  digits?: number;
  /** The value is filled in from the other two fields. */
  dimmed?: boolean;
  autoFocus?: boolean;
  /** False where a step would cause a problem: no step, no neighbour. */
  canStep?: (delta: number) => boolean;
  onStep: (delta: number) => void;
  onSet: (value: number) => void;
}) {
  const wheelRef = useRef<HTMLDivElement>(null);
  const drumRef = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState<string | null>(null);
  const neighbour = (delta: number) => {
    if (!canStep(delta)) return "";
    const next = value + delta;
    if (cycle) return pad((next + cycle) % cycle);
    return next < 0 ? "" : pad(next);
  };

  const step = (delta: number) => {
    if (!canStep(delta)) return;
    onStep(delta);
    const reduceMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (!reduceMotion)
      drumRef.current?.animate?.(
        [
          { transform: `translateY(${delta > 0 ? 30 : -30}%)`, opacity: 0.4 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 140, easing: "ease-out" },
      );
  };
  const stepRef = useRef(step);
  stepRef.current = step;

  // The wheel listener must not be passive, or the dialog scrolls along.
  useEffect(() => {
    const drum = wheelRef.current;
    if (!drum) return;
    let pending = 0;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // A mouse notch is about 100; a touchpad sends many small deltas.
      pending += event.deltaY;
      if (Math.abs(pending) < 40) return;
      stepRef.current(pending < 0 ? 1 : -1);
      pending = 0;
    };
    drum.addEventListener("wheel", onWheel, { passive: false });
    return () => drum.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div ref={wheelRef} className="flex flex-col items-center overflow-hidden">
      <div ref={drumRef} className="flex flex-col items-center">
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => step(1)}
          className="h-6 font-mono text-sm tabular-nums text-text-faint transition hover:text-text"
        >
          {neighbour(1)}
        </button>
        <input
          type="text"
          inputMode="numeric"
          aria-labelledby={labelledBy}
          value={typed ?? pad(value)}
          data-autofocus={autoFocus ? true : undefined}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={() => setTyped(null)}
          onChange={(event) => {
            const text = event.target.value.replace(/\D/g, "").slice(-digits);
            setTyped(text);
            if (text) onSet(Number(text));
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              setTyped(null);
              step(event.key === "ArrowUp" ? 1 : -1);
            }
          }}
          className={clsx(
            "w-14 rounded-lg border bg-surface py-1 text-center selection:bg-accent/30 font-mono text-2xl font-bold tabular-nums outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30",
            dimmed
              ? "border-border text-text-muted"
              : "border-border text-text",
          )}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => step(-1)}
          className="h-6 font-mono text-sm tabular-nums text-text-faint transition hover:text-text"
        >
          {neighbour(-1)}
        </button>
      </div>
      <span aria-hidden="true" className="h-4 text-[11px] text-text-faint">
        {caption}
      </span>
    </div>
  );
}
