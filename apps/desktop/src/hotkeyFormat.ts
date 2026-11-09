import { getT } from "./i18n";

const t = getT("settings");

/** A saved shortcut as the player reads it, in the app's language. */
export function formatHotkey(shortcut: string | null | undefined) {
  if (!shortcut) return t("Not set");
  return formatHotkeyParts(shortcut).join("+");
}

/** The same, one key per item, for key caps. */
export function formatHotkeyParts(shortcut: string | null | undefined) {
  if (!shortcut) return [];
  const modifiers: Record<string, string> = {
    Control: t("Ctrl"),
    Alt: t("Alt"),
    Shift: t("Shift"),
    Super: t("Win / Cmd"),
  };
  const numpad: Record<string, string> = {
    Add: "+",
    Subtract: "-",
    Multiply: "*",
    Divide: "/",
    Decimal: ".",
  };
  return shortcut.split("+").map((part) => {
    if (modifiers[part]) return modifiers[part];
    const num = /^Numpad(.+)$/.exec(part);
    if (num) return `${t("Num")} ${numpad[num[1]] ?? num[1]}`;
    return part.replace(/^Key([A-Z])$/, "$1").replace(/^Digit([0-9])$/, "$1");
  });
}
