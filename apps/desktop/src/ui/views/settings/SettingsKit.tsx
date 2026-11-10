import { Eye, Info, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { previewDesktopOverlay } from "../../../desktopOverlayBridge";
import type { DesktopOverlayKind } from "../../../desktopOverlays";
import { getT } from "../../../i18n";
import { cn } from "../../cn";
import { Button } from "../../primitives";

const t = getT("settings");

export type RowLevel = 0 | 1 | 2;

/** What every row gets from its page: how deep it sits under the switches it
 *  needs, and whether one of them is off. */
export type SettingsRowProps = { level: RowLevel; disabled: boolean };

const levelClass = (level: RowLevel, kind: "row" | "hint") =>
  level === 1
    ? `settings-${kind}-l1`
    : level === 2
      ? `settings-${kind}-l2`
      : undefined;

/** One group of Settings: its header, then its sections. */
export function SettingsPage({
  group,
  icon: Icon,
  title,
  description,
  dataTour,
  foot,
  children,
}: {
  group: string;
  icon: LucideIcon;
  title: string;
  description: string;
  dataTour?: string;
  foot?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-settings-page={group}
      data-tour={dataTour}
      className="settings-page grid gap-[18px]"
    >
      <header className="flex items-start gap-3.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-accent-tint text-accent-ink ring-1 ring-inset ring-accent/25">
          <Icon size={20} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[19px] font-semibold tracking-[-0.01em] text-text">
            {title}
          </h2>
          <p className="mt-0.5 max-w-[72ch] text-sm text-text-muted">
            {description}
          </p>
        </div>
      </header>
      {children}
      {foot ? <SettingsNote>{foot}</SettingsNote> : null}
    </div>
  );
}

/** A titled card of rows. `danger` draws it red, like Reset. */
export function SettingsSection({
  title,
  description,
  hint,
  danger = false,
  dataTour,
  children,
}: {
  title?: string;
  description?: string;
  hint?: ReactNode;
  danger?: boolean;
  dataTour?: string;
  children: ReactNode;
}) {
  return (
    <section
      data-danger={danger ? "" : undefined}
      data-tour={dataTour}
      className="grid gap-2"
    >
      {title ? (
        <div className="mx-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-text-faint">
            {title}
          </h3>
          {hint}
        </div>
      ) : null}
      {description ? (
        <p className="mx-1 max-w-[72ch] text-[13px] text-text-muted">
          {description}
        </p>
      ) : null}
      <div
        className={cn(
          "settings-card overflow-hidden rounded-xl border bg-surface shadow-raised",
          danger ? "border-danger-border" : "border-border",
        )}
      >
        {children}
      </div>
    </section>
  );
}

/** A setting: name and explanation on the left, its control on the right,
 *  anything longer (a list, a path, a warning) below. */
export function SettingsRow({
  id,
  title,
  description,
  control,
  below,
  level = 0,
  disabled = false,
  dataTour,
  icon,
}: {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  below?: ReactNode;
  level?: RowLevel;
  disabled?: boolean;
  dataTour?: string;
  icon?: ReactNode;
}) {
  return (
    <div
      data-row={id}
      data-tour={dataTour}
      className={cn(
        "settings-row",
        levelClass(level, "row"),
        disabled && "settings-row-off",
      )}
    >
      <div className="settings-row-text min-w-0">
        <div className="flex items-center gap-2 text-[15px] font-medium text-text">
          {icon}
          <span className="min-w-0">{title}</span>
        </div>
        {description ? (
          <div className="mt-0.5 max-w-[74ch] text-sm leading-[1.45] text-text-muted">
            {description}
          </div>
        ) : null}
      </div>
      {control ? <div className="settings-row-control">{control}</div> : null}
      {below ? <div className="settings-row-below">{below}</div> : null}
    </div>
  );
}

/** Under a switch that is off: why the rows below it don't work. */
export function TurnOnFirst({
  setting,
  level,
}: {
  setting: string;
  level: RowLevel;
}) {
  return (
    <div className={cn("settings-hint", levelClass(level, "hint"))}>
      <Info size={14} aria-hidden="true" className="shrink-0 text-accent-ink" />
      {t("Turn on “{{setting}}” first.", { setting })}
    </div>
  );
}

/** The same, next to a section title. */
export function SectionTurnOnFirst({ setting }: { setting: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
      <Info size={13} aria-hidden="true" className="shrink-0 text-accent-ink" />
      {t("Turn on “{{setting}}” first.", { setting })}
    </span>
  );
}

/** A short note under a page or a section. */
export function SettingsNote({ children }: { children: ReactNode }) {
  return (
    <p className="mx-1 flex max-w-[80ch] items-start gap-2 text-[12.5px] leading-normal text-text-muted">
      <Info
        size={14}
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-text-faint"
      />
      <span>{children}</span>
    </p>
  );
}

export type SegmentedOption<T> = {
  value: T;
  label: string;
  isDefault?: boolean;
};

/** Every choice at once, as a row of buttons. */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  dataTour,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
  dataTour?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      data-tour={dataTour}
      className="inline-flex shrink-0 gap-0.5 rounded-[9px] border border-border bg-bg/50 p-[3px]"
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            title={
              option.isDefault
                ? t("{{option}} (default)", { option: option.label })
                : undefined
            }
            onClick={() => onChange(option.value)}
            className={cn(
              "relative h-[30px] whitespace-nowrap rounded-md px-3 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50",
              on
                ? "bg-accent-tint text-accent-ink ring-1 ring-inset ring-accent/60"
                : "text-text-muted hover:bg-surface-hover hover:text-text",
            )}
          >
            {option.label}
            {option.isDefault ? (
              <span
                aria-hidden="true"
                className="absolute bottom-[3px] left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-current opacity-70"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Shows a popup of this kind with sample data, even while it is off. */
export function PreviewButton({
  kind,
  name,
}: {
  kind: DesktopOverlayKind;
  name: string;
}) {
  return (
    <Button
      variant="ghost"
      icon={Eye}
      title={t("Preview: {{popup}}", { popup: name })}
      className="h-[30px] px-2.5 text-[13px]"
      onClick={() => previewDesktopOverlay(kind)}
    >
      {t("Preview")}
    </Button>
  );
}
