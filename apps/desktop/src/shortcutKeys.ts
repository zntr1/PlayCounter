/** Keys nobody types, so they may stand alone. Numpad Enter is left out:
 *  Windows sends it as Enter. */
const ALONE =
  /^(F([1-9]|1[0-9]|2[0-4])|Numpad([0-9]|Add|Subtract|Multiply|Divide|Decimal)|Pause|ScrollLock|PrintScreen|MediaPlayPause|MediaStop|MediaTrackNext|MediaTrackPrevious|AudioVolume(Up|Down|Mute))$/;

/** The four punctuation keys Windows names by what they type on every
 *  layout (VK_OEM_PLUS, _COMMA, _MINUS, _PERIOD), as the names Rust maps to
 *  them. The others (ß, ü, #, < on a German keyboard) get layout-dependent
 *  codes, so recording their position would bind another key. */
const SAME_ON_EVERY_LAYOUT: Record<number, string> = {
  187: "Equal",
  188: "Comma",
  189: "Minus",
  190: "Period",
};

/**
 * Native Windows hotkeys use virtual letter keys, so honor the active keyboard layout.
 * The result is the format Rust parses, so it stays English in every language.
 * Kept free of the app store, so the counter box window can record keys too.
 *
 * Typing keys need Ctrl, Alt or Win: a hotkey takes its key from every app,
 * the game too. Keys nobody types may stand alone.
 */
export function shortcutFromKey(
  event: Pick<
    KeyboardEvent,
    "key" | "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "repeat"
  > & { keyCode?: number },
): string | null {
  if (event.repeat) return null;
  // Windows' own code for the key, not its position.
  const punctuation = SAME_ON_EVERY_LAYOUT[event.keyCode ?? 0];
  const code =
    punctuation ??
    (/^Key[A-Z]$/.test(event.code)
      ? /^[a-z]$/i.test(event.key)
        ? `Key${event.key.toUpperCase()}`
        : ""
      : event.code);
  // Windows turns Ctrl+Pause into Break, so that hotkey would never fire.
  if (code === "Pause" && event.ctrlKey) return null;
  const alone = ALONE.test(code);
  const supported =
    alone ||
    Boolean(punctuation) ||
    /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|Enter|Home|End|PageUp|PageDown|Insert|Delete|Backspace|Tab)$/.test(
      code,
    );
  if (
    !alone &&
    (!supported || !(event.ctrlKey || event.altKey || event.metaKey))
  )
    return null;
  return [
    event.ctrlKey && "Control", // i18n-exempt: shortcut format, translated in formatHotkey
    event.altKey && "Alt",
    event.shiftKey && "Shift",
    event.metaKey && "Super",
    code,
  ]
    .filter(Boolean)
    .join("+");
}

/** Windows sends no keydown for Print Screen, only the keyup. */
export function recordsOnKeyUp(event: Pick<KeyboardEvent, "code">) {
  return event.code === "PrintScreen";
}
