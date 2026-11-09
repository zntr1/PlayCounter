import { Check, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { formatHotkeyParts } from "../../../hotkeyFormat";
import {
  saveHotkey,
  shortcutFromKey,
  useHotkeyStatus,
  type HotkeySetting,
} from "../../../hotkeys";
import { getT } from "../../../i18n";
import { currentPlatform } from "../../../platform";
import { useAppStore } from "../../../store";
import { cn } from "../../cn";
import { IconButton } from "../../primitives";
import { SettingsRow, type SettingsRowProps } from "./SettingsKit";

const t = getT("settings");

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta"]);

/** A hotkey: click its keys, press the new ones, and it is saved. Esc
 *  cancels, × turns it off. */
export function HotkeyRow({
  setting,
  title,
  description,
  macText,
  level,
  disabled,
}: SettingsRowProps & {
  setting: HotkeySetting;
  title: string;
  description: string;
  /** Why it can't work on macOS; leave out when it does. */
  macText?: string;
}) {
  const unsupported = currentPlatform() === "macos" && Boolean(macText);
  return (
    <SettingsRow
      id={setting}
      level={level}
      disabled={disabled || unsupported}
      title={title}
      description={unsupported ? macText : description}
      control={
        <HotkeyKeys
          setting={setting}
          label={title}
          disabled={disabled || unsupported}
        />
      }
    />
  );
}

function HotkeyKeys({
  setting,
  label,
  disabled,
}: {
  setting: HotkeySetting;
  label: string;
  disabled: boolean;
}) {
  const saved = useAppStore((state) => state.settings[setting] ?? null);
  const error = useHotkeyStatus((state) => state.errors[setting]);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (!justSaved) return;
    const timer = window.setTimeout(() => setJustSaved(false), 1600);
    return () => window.clearTimeout(timer);
  }, [justSaved]);

  async function apply(value: string | null) {
    setRecording(false);
    setHint(false);
    setSaving(true);
    try {
      await saveHotkey(setting, value);
      setJustSaved(value !== null);
    } catch {
      // The hotkey status shows the failure under the keys.
    } finally {
      setSaving(false);
    }
  }

  const keys = formatHotkeyParts(saved);
  return (
    <div className="grid justify-items-end gap-1.5">
      <div className="flex items-center gap-1">
        {justSaved ? (
          <span
            role="status"
            className="mr-1 inline-flex items-center gap-1 text-xs font-semibold text-success"
          >
            <Check size={14} strokeWidth={2.5} aria-hidden="true" />
            {t("Saved")}
          </span>
        ) : null}
        <button
          type="button"
          aria-label={t("{{label}} hotkey", { label })}
          disabled={disabled || saving}
          onClick={() => {
            setRecording((current) => !current);
            setHint(false);
          }}
          onBlur={() => {
            setRecording(false);
            setHint(false);
          }}
          onKeyDown={(event) => {
            if (!recording) return;
            if (
              event.key === "Tab" &&
              !event.ctrlKey &&
              !event.altKey &&
              !event.metaKey
            ) {
              setRecording(false);
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            if (event.key === "Escape") {
              setRecording(false);
              setHint(false);
              return;
            }
            if (MODIFIER_KEYS.has(event.key)) return;
            const shortcut = shortcutFromKey(event);
            if (shortcut) void apply(shortcut);
            else if (!event.repeat) setHint(true);
          }}
          className={cn(
            "inline-flex h-9 min-w-[11.5rem] items-center gap-1 rounded-lg border bg-bg/55 px-2.5 text-[13px] outline-none transition focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50",
            recording
              ? "border-accent font-medium text-accent-ink ring-[3px] ring-accent/25"
              : keys.length
                ? "border-border text-text hover:border-text-faint"
                : "border-dashed border-border text-text-faint hover:border-text-faint",
          )}
        >
          {recording ? (
            <span className="animate-pulse">
              {t("Press a key combination…")}
            </span>
          ) : keys.length ? (
            keys.map((key, index) => (
              <span key={index} className="inline-flex items-center gap-1">
                {index > 0 ? (
                  <span
                    aria-hidden="true"
                    className="text-[11px] text-text-faint"
                  >
                    +
                  </span>
                ) : null}
                <kbd className="rounded-[5px] border border-b-2 border-border bg-surface px-[7px] py-px font-mono text-xs font-semibold text-text">
                  {key}
                </kbd>
              </span>
            ))
          ) : (
            <>
              <Plus size={14} aria-hidden="true" />
              {t("Not set")}
            </>
          )}
        </button>
        {keys.length && !recording ? (
          <IconButton
            icon={X}
            aria-label={t("Clear {{label}} hotkey", { label })}
            title={t("Clear {{label}} hotkey", { label })}
            disabled={disabled || saving}
            className="border-transparent"
            onClick={() => void apply(null)}
          />
        ) : (
          <span aria-hidden="true" className="w-8 shrink-0" />
        )}
      </div>
      {hint ? (
        <p className="max-w-[20rem] text-right text-xs text-warning">
          {t(
            "Use Ctrl, Alt or Win / Cmd with a letter, number or navigation key, or use F1–F24.",
          )}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="max-w-[20rem] break-words text-right text-xs text-danger"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
