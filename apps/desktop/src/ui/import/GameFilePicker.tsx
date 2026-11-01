import clsx from "clsx";
import { FolderOpen } from "lucide-react";
import { appLocale, getT } from "../../i18n";
import type { ScannedExecutable } from "../../library/types";
import { Button } from "../primitives";

const t = getT("import");

/** "Which file starts the game?": every candidate visible, plus Browse. */
export function GameFilePicker({
  gameName,
  options,
  value,
  onPick,
  onBrowse,
  browsing,
}: {
  gameName: string;
  options: readonly ScannedExecutable[];
  value: string | undefined;
  onPick: (relativePath: string) => void;
  onBrowse: () => void;
  browsing: boolean;
}) {
  const size = new Intl.NumberFormat(appLocale(), {
    style: "unit",
    unit: "megabyte",
    maximumFractionDigits: 1,
  });
  return (
    <div className="grid gap-1.5">
      <div
        role="radiogroup"
        aria-label={t("Game file for {{name}}", { name: gameName })}
        className="grid max-w-2xl gap-1.5"
      >
        {options.map((option) => {
          const checked = option.relativePath === value;
          return (
            <label
              key={option.relativePath}
              className={clsx(
                "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition",
                checked
                  ? "border-accent/70 bg-accent-tint"
                  : "border-border bg-surface hover:border-text-faint",
              )}
            >
              <input
                type="radio"
                name={`game-file-${gameName}`}
                value={option.relativePath}
                checked={checked}
                onChange={() => onPick(option.relativePath)}
                className="h-4 w-4 shrink-0 accent-[rgb(var(--color-accent))]"
              />
              <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-semibold text-text">
                {option.relativePath}
              </span>
              {option.declared ? (
                <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent-ink">
                  {t("Named by the game")}
                </span>
              ) : null}
              <span className="shrink-0 text-xs text-text-faint">
                {size.format(option.sizeBytes / 1_000_000)}
              </span>
            </label>
          );
        })}
      </div>
      <Button
        variant="ghost"
        icon={FolderOpen}
        loading={browsing}
        onClick={onBrowse}
        className="justify-self-start"
      >
        {t("Browse…")}
      </Button>
    </div>
  );
}
