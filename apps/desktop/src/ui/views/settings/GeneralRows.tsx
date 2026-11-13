import { AlertTriangle, Moon, Sun } from "lucide-react";
import { disable, enable } from "@tauri-apps/plugin-autostart";
import {
  APP_LANGUAGES,
  LANGUAGE_NAMES,
  appLanguage,
  appLocale,
  formatNumericDate,
  formatRegions,
  getT,
  isAppLanguage,
  systemLanguage,
} from "../../../i18n";
import {
  DEFAULT_CONTENT_SCALE,
  DEFAULT_MENU_SCALE,
  SCALE_OPTIONS,
  normalizeInterfaceScale,
} from "../../../interfaceScale";
import { useAppStore } from "../../../store";
import { DEFAULT_ACCENT_COLOR } from "../../../theme";
import { cn } from "../../cn";
import { Button, Select, Switch } from "../../primitives";
import { Segmented, SettingsRow, type SettingsRowProps } from "./SettingsKit";
import { formatError, setSettingsOp, useSettingsOps } from "./settingsOps";

const t = getT("settings");

/* ── General ─────────────────────────────────────────────── */

export function LaunchOnStartupRow({ level, disabled }: SettingsRowProps) {
  const enabled = useAppStore((state) => state.settings.launchOnStartup);
  const setLaunchOnStartup = useAppStore((state) => state.setLaunchOnStartup);
  const syncing = useSettingsOps((state) => state.startupSyncing);
  const error = useSettingsOps((state) => state.startupError);

  async function change(next: boolean) {
    setSettingsOp({ startupSyncing: true, startupError: null });
    try {
      if (next) await enable();
      else await disable();
      setLaunchOnStartup(next);
    } catch (failure) {
      setSettingsOp({ startupError: formatError(failure) });
    } finally {
      setSettingsOp({ startupSyncing: false });
    }
  }

  return (
    <SettingsRow
      id="launchOnStartup"
      level={level}
      disabled={disabled}
      title={t("Launch on startup")}
      description={t(
        "Strongly recommended. PlayCounter starts when you sign in, so no game session is missed. If this is off, tracking only works after you open the app yourself.",
      )}
      control={
        <Switch
          aria-label={t("Launch on startup")}
          checked={enabled}
          disabled={disabled || syncing}
          onChange={(event) => void change(event.target.checked)}
        />
      }
      below={
        !enabled && !syncing ? (
          <div className="flex items-start gap-3 rounded-lg border border-danger-border bg-danger-tint px-4 py-3 text-sm text-danger">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">{t("Auto-start is disabled")}</div>
              <p className="mt-1 leading-5">
                {t(
                  "This is not recommended. PlayCounter cannot detect or record sessions until you open it manually.",
                )}
              </p>
            </div>
          </div>
        ) : error ? (
          <p className="break-words text-sm text-danger">{error}</p>
        ) : null
      }
    />
  );
}

export function StartPageRow({ level, disabled }: SettingsRowProps) {
  const startView = useAppStore((state) =>
    state.settings.startView === "games" ? "games" : "now",
  );
  const setStartView = useAppStore((state) => state.setStartView);
  return (
    <SettingsRow
      id="startView"
      level={level}
      disabled={disabled}
      title={t("Start page")}
      description={t("The page PlayCounter shows when it opens.")}
      control={
        <Segmented
          label={t("Start page")}
          value={startView}
          disabled={disabled}
          options={[
            { value: "now", label: t("Now Playing") },
            { value: "games", label: t("My Games") },
          ]}
          onChange={setStartView}
        />
      }
    />
  );
}

export function LanguageRow({ level, disabled }: SettingsRowProps) {
  const language = useAppStore((state) => state.settings.language);
  const setLanguage = useAppStore((state) => state.setLanguage);
  return (
    <SettingsRow
      id="language"
      level={level}
      disabled={disabled}
      title={t("Language")}
      description={t(
        "System uses your computer's language when PlayCounter has it, otherwise English.",
      )}
      control={
        <Select
          aria-label={t("Language")}
          disabled={disabled}
          value={isAppLanguage(language) ? language : "system"}
          onChange={(event) =>
            setLanguage(
              isAppLanguage(event.target.value) ? event.target.value : "system",
            )
          }
        >
          <option value="system">
            {t("System ({{language}})", {
              language: LANGUAGE_NAMES[systemLanguage()],
            })}
          </option>
          {APP_LANGUAGES.map((option) => (
            <option key={option} value={option}>
              {LANGUAGE_NAMES[option]}
            </option>
          ))}
        </Select>
      }
    />
  );
}

/** Saturday, 7 November 2026, 21:14 and a number, the way they look now. */
function formatExample() {
  const sample = new Date(2026, 10, 7, 21, 14);
  return [
    sample.toLocaleDateString(appLocale(), {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
    formatNumericDate(sample),
    sample.toLocaleTimeString(appLocale(), {
      hour: "numeric",
      minute: "2-digit",
    }),
    (1234.5).toLocaleString(appLocale()),
  ].join(" · ");
}

export function FormatRegionRow({ level, disabled }: SettingsRowProps) {
  const region = useAppStore((state) => state.settings.formatRegion ?? null);
  // The example follows the language and the clock too.
  const formats = useAppStore(
    (state) =>
      `${state.settings.language}|${state.settings.formatRegion}|${state.settings.clockFormat}`,
  );
  const setFormatRegion = useAppStore((state) => state.setFormatRegion);
  const regions = formatRegions(appLanguage());
  const names = new Intl.DisplayNames(appLocale(), { type: "region" });
  const collator = new Intl.Collator(appLocale());
  const options = regions
    .map((code) => [code, names.of(code) ?? code] as const)
    .sort((left, right) => collator.compare(left[1], right[1]));
  return (
    <SettingsRow
      id="formatRegion"
      level={level}
      disabled={disabled}
      title={t("Format region")}
      description={
        <>
          {t(
            "Dates, times and numbers the way this country writes them, in the app's language. Automatic follows your language and computer.",
          )}
          <span
            key={formats}
            className="mt-1 block font-mono text-[13px] text-text"
          >
            {t("Example: {{example}}", { example: formatExample() })}
          </span>
        </>
      }
      control={
        <Select
          aria-label={t("Format region")}
          disabled={disabled}
          // A country the language can't take (after a language switch)
          // shows as Automatic, which is what dates then use.
          value={region && regions.includes(region) ? region : "auto"}
          onChange={(event) =>
            setFormatRegion(
              event.target.value === "auto" ? null : event.target.value,
            )
          }
        >
          <option value="auto">{t("Automatic")}</option>
          {options.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </Select>
      }
    />
  );
}

export function ClockFormatRow({ level, disabled }: SettingsRowProps) {
  const clock = useAppStore((state) => state.settings.clockFormat ?? "auto");
  const setClockFormat = useAppStore((state) => state.setClockFormat);
  return (
    <SettingsRow
      id="clockFormat"
      level={level}
      disabled={disabled}
      title={t("Clock")}
      description={t(
        "Show times with 24 hours or with AM and PM. Automatic follows the format region.",
      )}
      control={
        <Segmented
          label={t("Clock")}
          value={clock}
          disabled={disabled}
          options={[
            { value: "auto", label: t("Automatic") },
            { value: "24h", label: t("24-hour") },
            { value: "12h", label: t("12-hour") },
          ]}
          onChange={setClockFormat}
        />
      }
    />
  );
}

export function ShowDaysRow({ level, disabled }: SettingsRowProps) {
  const checked = useAppStore((state) => state.settings.showDurationDays);
  const setShowDurationDays = useAppStore((state) => state.setShowDurationDays);
  return (
    <SettingsRow
      id="showDurationDays"
      level={level}
      disabled={disabled}
      title={t("Show days in playtime")}
      description={t(
        "Shows long playtimes as days and hours instead of total hours.",
      )}
      control={
        <Switch
          aria-label={t("Show days in playtime")}
          checked={checked}
          disabled={disabled}
          onChange={(event) => setShowDurationDays(event.target.checked)}
        />
      }
    />
  );
}

/* ── Appearance ──────────────────────────────────────────── */

export function ThemeRow({ level, disabled }: SettingsRowProps) {
  const theme = useAppStore((state) => state.settings.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const card = (value: "dark" | "light") => {
    const on = theme === value;
    const dark = value === "dark";
    const Icon = dark ? Moon : Sun;
    return (
      <button
        type="button"
        aria-pressed={on}
        disabled={disabled}
        onClick={() => setTheme(value)}
        className={cn(
          "grid justify-items-center gap-1.5 rounded-[10px] border bg-bg/40 px-1.5 pb-1 pt-1.5 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50",
          on
            ? "border-accent text-text ring-1 ring-accent"
            : "border-border text-text-muted hover:border-text-faint",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "relative block h-[62px] w-28 overflow-hidden rounded-md ring-1 ring-inset",
            dark
              ? "bg-[#0d0d0e] ring-[#2a2a2e]"
              : "bg-[#f2ece1] ring-[#d8cebc]",
          )}
        >
          <span
            className={cn(
              "absolute inset-y-0 left-0 w-[26px]",
              dark ? "bg-[#151517]" : "bg-[#fffcf5] shadow-[1px_0_0_#d8cebc]",
            )}
          />
          <span className="absolute left-[5px] top-2 h-[5px] w-4 rounded-sm bg-accent" />
          <span
            className={cn(
              "absolute left-[34px] top-2 h-2 w-[70px] rounded-sm",
              dark ? "bg-[#232327]" : "bg-[#e6dccb]",
            )}
          />
          <span
            className={cn(
              "absolute left-[34px] top-[22px] h-8 w-[70px] rounded-sm ring-1 ring-inset",
              dark
                ? "bg-[#151517] ring-[#2a2a2e]"
                : "bg-[#fffcf5] ring-[#d8cebc]",
            )}
          />
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Icon size={14} aria-hidden="true" />
          {dark ? t("Dark") : t("Light")}
        </span>
      </button>
    );
  };
  return (
    <SettingsRow
      id="theme"
      level={level}
      disabled={disabled}
      title={t("Theme")}
      description={t("Choose a light or dark theme.")}
      control={
        <div role="group" aria-label={t("Theme")} className="flex gap-2.5">
          {card("dark")}
          {card("light")}
        </div>
      }
    />
  );
}

// Ready colors next to your own. The first is PlayCounter's default.
function accentChoices(): ReadonlyArray<readonly [string, string]> {
  return [
    [DEFAULT_ACCENT_COLOR, t("Amber (default)")],
    ["#fb923c", t("Orange")],
    ["#fb7185", t("Rose")],
    ["#f472b6", t("Pink")],
    ["#a78bfa", t("Violet")],
    ["#60a5fa", t("Blue")],
    ["#2dd4bf", t("Teal")],
    ["#4ade80", t("Green")],
  ];
}

export function AccentColorRow({ level, disabled }: SettingsRowProps) {
  const accentColor = useAppStore((state) => state.settings.accentColor);
  const setAccentColor = useAppStore((state) => state.setAccentColor);
  const current = (accentColor ?? DEFAULT_ACCENT_COLOR).toLowerCase();
  const choices = accentChoices();
  const custom = !choices.some(([color]) => color === current);
  const ring = "0 0 0 2px rgb(var(--color-surface)), 0 0 0 4px";
  return (
    <SettingsRow
      id="accentColor"
      level={level}
      disabled={disabled}
      title={t("Accent color")}
      description={t(
        "Choose an accent color. PlayCounter adjusts it automatically for readable contrast in both themes.",
      )}
      control={
        <div className="flex max-w-[30rem] flex-wrap items-center justify-end gap-2">
          {choices.map(([color, name]) => (
            <button
              key={color}
              type="button"
              aria-label={name}
              title={name}
              aria-pressed={current === color}
              disabled={disabled}
              onClick={() =>
                setAccentColor(color === DEFAULT_ACCENT_COLOR ? null : color)
              }
              className="h-6 w-6 shrink-0 rounded-full transition hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
              style={{
                background: color,
                boxShadow:
                  current === color
                    ? `${ring} ${color}`
                    : "inset 0 0 0 1px rgb(0 0 0 / 0.25)",
              }}
            />
          ))}
          <label
            title={t("Your own color")}
            className="relative grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded-full bg-[conic-gradient(#f87171,#fbbf24,#4ade80,#22d3ee,#818cf8,#f472b6,#f87171)] transition hover:scale-110"
            style={custom ? { boxShadow: `${ring} ${current}` } : undefined}
          >
            <input
              type="color"
              aria-label={t("Choose accent color")}
              value={current}
              disabled={disabled}
              onChange={(event) => setAccentColor(event.target.value)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
          <span className="w-[4.5rem] font-mono text-xs text-text-muted">
            {current}
          </span>
          <Button
            variant="ghost"
            className="h-[30px] px-2.5 text-[13px]"
            disabled={disabled || !accentColor}
            onClick={() => setAccentColor(null)}
          >
            {t("Reset")}
          </Button>
        </div>
      }
    />
  );
}

function scaleOptions(defaultScale: number) {
  return SCALE_OPTIONS.map((option) => ({
    value: option.value as number,
    label: option.label,
    isDefault: option.value === defaultScale,
  }));
}

export function ContentSizeRow({ level, disabled }: SettingsRowProps) {
  const scale = useAppStore((state) =>
    normalizeInterfaceScale(state.settings.contentScale, DEFAULT_CONTENT_SCALE),
  );
  const setInterfaceScale = useAppStore((state) => state.setInterfaceScale);
  return (
    <SettingsRow
      id="contentScale"
      level={level}
      disabled={disabled}
      title={t("Content size")}
      description={t(
        "Text, icons, covers and spacing in the main area scale together. Menus and dialogs keep their size.",
      )}
      control={
        <Segmented
          label={t("Content size")}
          value={scale}
          disabled={disabled}
          options={scaleOptions(DEFAULT_CONTENT_SCALE)}
          onChange={(value) => setInterfaceScale("content", value)}
        />
      }
    />
  );
}

export function MenuSizeRow({ level, disabled }: SettingsRowProps) {
  const scale = useAppStore((state) =>
    normalizeInterfaceScale(state.settings.menuScale, DEFAULT_MENU_SCALE),
  );
  const setInterfaceScale = useAppStore((state) => state.setInterfaceScale);
  return (
    <SettingsRow
      id="menuScale"
      level={level}
      disabled={disabled}
      title={t("Menu size")}
      description={t("The sidebar and the title bar with the search field.")}
      control={
        <Segmented
          label={t("Menu size")}
          value={scale}
          disabled={disabled}
          options={scaleOptions(DEFAULT_MENU_SCALE)}
          onChange={(value) => setInterfaceScale("menu", value)}
        />
      }
    />
  );
}

export function AdultArtRow({ level, disabled }: SettingsRowProps) {
  const checked = useAppStore((state) => state.settings.showAdultArt === true);
  const setShowAdultArt = useAppStore((state) => state.setShowAdultArt);
  return (
    <SettingsRow
      id="showAdultArt"
      level={level}
      disabled={disabled}
      title={t("Show 18+ art")}
      description={t(
        "Include SteamGridDB artwork marked 18+ when you pick covers and banners. Art you share with the community always stays safe for work.",
      )}
      control={
        <Switch
          aria-label={t("Show 18+ art")}
          checked={checked}
          disabled={disabled}
          onChange={(event) => setShowAdultArt(event.target.checked)}
        />
      }
    />
  );
}
