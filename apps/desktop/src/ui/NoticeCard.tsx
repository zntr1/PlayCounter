import { X } from "lucide-react";
import type { ReactNode } from "react";
import { getT } from "../i18n";
import { cn } from "./cn";

const t = getT("common");

export type NoticeTone = "warning" | "danger" | "accent" | "info";

const TONES: Record<NoticeTone, { card: string; chip: string }> = {
  warning: {
    card: "from-warning/[0.13] via-warning/[0.04]",
    chip: "bg-warning/15 text-warning ring-warning/25",
  },
  danger: {
    card: "from-danger/[0.13] via-danger/[0.04]",
    chip: "bg-danger/15 text-danger ring-danger/25",
  },
  accent: {
    card: "from-accent/[0.13] via-accent/[0.04]",
    chip: "bg-accent/15 text-accent-ink ring-accent/25",
  },
  info: {
    card: "from-info/[0.13] via-info/[0.04]",
    chip: "bg-info/15 text-info ring-info/25",
  },
};

/** A notice above the page (update, paused requests, errors, language): a
 *  card with a coloured symbol, its text and buttons, and a close button when
 *  `onClose` is given. `children` go under the text, inside the live region;
 *  `aside` sits outside it, for things that change without being read out. */
export function NoticeCard({
  tone,
  icon,
  title,
  text,
  live = "status",
  children,
  aside,
  actions,
  onClose,
}: {
  tone: NoticeTone;
  icon: ReactNode;
  title?: ReactNode;
  text?: ReactNode;
  live?: "status" | "alert";
  children?: ReactNode;
  aside?: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
}) {
  const tones = TONES[tone];
  return (
    <div
      className={cn(
        "flex animate-fade-in items-center gap-3.5 rounded-[14px] border border-border/70 bg-surface bg-gradient-to-r via-40% to-transparent to-70% py-3 pl-3.5 pr-2.5 shadow-raised",
        tones.card,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] ring-1 ring-inset",
          tones.chip,
        )}
      >
        {icon}
      </span>
      <div role={live} aria-atomic="true" className="min-w-0 flex-1">
        {title ? (
          <p className="text-[14.5px] font-semibold leading-5 text-text">
            {title}
          </p>
        ) : null}
        {text ? (
          <p
            className={
              title ? "mt-px text-[13px] text-text-muted" : "text-sm text-text"
            }
          >
            {text}
          </p>
        ) : null}
        {children}
      </div>
      {aside}
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
      {onClose ? (
        <button
          type="button"
          aria-label={t("Close")}
          title={t("Close")}
          onClick={onClose}
          className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg text-text-muted transition hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <X size={16} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
