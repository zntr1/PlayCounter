import { useEffect, useState } from "react";
import {
  formatHotkey,
  saveHotkey,
  shortcutFromKey,
  useHotkeyStatus,
  type HotkeySetting,
} from "../hotkeys";
import { useAppStore } from "../store";
import { Button } from "./primitives";

export function HotkeyInput({
  setting,
  label,
  disabled = false,
}: {
  setting: HotkeySetting;
  label: string;
  disabled?: boolean;
}) {
  const saved = useAppStore((state) => state.settings[setting] ?? null);
  const error = useHotkeyStatus((state) => state.errors[setting]);
  const [draft, setDraft] = useState(saved);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => {
    setDraft(saved);
  }, [saved]);

  async function apply(value: string | null) {
    setSaving(true);
    setRecording(false);
    try {
      await saveHotkey(setting, value);
      setDraft(value);
      setHint(null);
    } catch {
      // The shared status also exposes failures while restoring saved shortcuts.
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid w-full gap-2 sm:w-80">
      <input
        aria-label={`${label} hotkey`}
        aria-describedby={`${setting}-help`}
        readOnly
        disabled={disabled || saving}
        value={recording ? "Press a key combination…" : formatHotkey(draft)}
        onFocus={() => {
          setRecording(true);
          setHint(null);
        }}
        onClick={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        onKeyDown={(event) => {
          if (
            event.key === "Tab" &&
            !event.ctrlKey &&
            !event.altKey &&
            !event.metaKey
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Escape") {
            setDraft(saved);
            setRecording(false);
            event.currentTarget.blur();
            return;
          }
          const shortcut = shortcutFromKey(event);
          if (shortcut) {
            setDraft(shortcut);
            setRecording(false);
            setHint(null);
            event.currentTarget.blur();
          } else if (!event.repeat) {
            setHint(
              "Use Ctrl, Alt or Win / Cmd with a letter, number or navigation key, or use F1–F24.",
            );
          }
        }}
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-accent focus:outline-none disabled:opacity-50"
      />
      <div className="flex gap-2">
        <Button
          disabled={disabled || saving || !draft || (draft === saved && !error)}
          onClick={() => void apply(draft)}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button
          disabled={disabled || saving || (!saved && !draft)}
          onClick={() => void apply(null)}
        >
          Clear
        </Button>
      </div>
      <p id={`${setting}-help`} className="text-xs text-text-faint">
        {hint ??
          "Click the field, press your combination, then Save. Clear disables it."}
      </p>
      {error ? (
        <p role="alert" className="break-words text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
