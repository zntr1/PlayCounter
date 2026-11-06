import clsx from "clsx";
import { type GameStatus } from "../personalLibrary";
import { STATUS_TONES } from "./journalStyles";

/** A progress status as its icon, in its colour. The same mark on the cover
 *  and in every menu that sets it, so one teaches the other. */
export function GameStatusIcon({
  status,
  size = 14,
  className,
}: {
  status: GameStatus;
  size?: number;
  className?: string;
}) {
  const { icon: Icon, filled, text } = STATUS_TONES[status];
  return (
    <Icon
      aria-hidden="true"
      size={size}
      strokeWidth={filled ? 2 : 2.75}
      fill={filled ? "currentColor" : "none"}
      className={clsx("shrink-0", text, className)}
    />
  );
}
