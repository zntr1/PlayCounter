import { ExternalLink, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../cn";

/* Building blocks of the game details tabs, shared by GameDetailsDialog and
   the tabs that live in their own files. */

export function Panel({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  icon: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-bg p-4">
      <header className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
          <Icon size={15} className="text-accent-ink" />
          {title}
        </h3>
        {action}
      </header>
      {children}
    </section>
  );
}

export function Figure({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-accent/20 bg-accent-tint text-accent-ink">
        <Icon size={17} />
      </span>
      <div className="min-w-0">
        <div className="text-[11px] font-medium text-text-faint">{label}</div>
        <div className="truncate font-mono text-base font-semibold text-text">
          {value}
        </div>
      </div>
    </div>
  );
}

/* Placeholders for the IGDB parts while they load: a pulsing block the size
   of the thing that is coming, so the dialog does not jump once the request
   lands. */
export function SkeletonBar({ className }: { className: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded bg-surface-hover motion-reduce:animate-none",
        className,
      )}
    />
  );
}

export function SourceTag({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-muted transition hover:border-accent/40 hover:text-text"
    >
      {label}
      <ExternalLink size={12} />
    </button>
  );
}
