/** Numpad keys global-hotkey maps on Windows. Numpad Enter is left out:
 *  Windows sends it as Enter. */
const NUMPAD = /^Numpad([0-9]|Add|Subtract|Multiply|Divide|Decimal)$/;

/**
 * Native Windows hotkeys use virtual letter keys, so honor the active keyboard layout.
 * The result is the format Rust parses, so it stays English in every language.
 * Kept free of the app store, so the counter box window can record keys too.
 *
 * `plain`: a Numpad key may stand alone. Only for a counter's key, which is
 * registered just while its game runs; an app-wide key would take the key
 * from every other app all the time.
 */
export function shortcutFromKey(
  event: Pick<
    KeyboardEvent,
    "key" | "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "repeat"
  >,
  { plain = false }: { plain?: boolean } = {},
): string | null {
  if (event.repeat) return null;
  const code = /^Key[A-Z]$/.test(event.code)
    ? /^[a-z]$/i.test(event.key)
      ? `Key${event.key.toUpperCase()}`
      : ""
    : event.code;
  const functionKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(code);
  const numpad = NUMPAD.test(code);
  const supported =
    numpad ||
    /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|Enter|Home|End|PageUp|PageDown|Insert|Delete|Backspace|Tab)$/.test(
      code,
    );
  if (
    !functionKey &&
    !(numpad && plain) &&
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
