import type { TOptions } from "i18next";
import { getT } from "./i18n";
import native from "./locales/en/native.json";

const t = getT("native");

type NativeKey = keyof typeof native;

/* The Rust side writes its messages in English. The ones a user can hit are
   the keys of native.json, values as {{name}}: "Could not open Steam:
   {{error}}". Unexpected errors have no key and stay English, like logs. */

const exactKeys = new Set<string>(Object.keys(native));

// More fixed text first, so "Could not read {{path}}: {{error}}" wins over
// "Could not read {{file}}.".
const patterns = (Object.keys(native) as NativeKey[])
  .filter((key) => key.includes("{{"))
  .map((key) => {
    const names: string[] = [];
    const parts = key.split(/\{\{(\w+)\}\}/);
    const source = parts
      .map((part, index) => {
        if (index % 2 === 0) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        names.push(part);
        return "(.+?)";
      })
      .join("");
    const fixedLength = parts
      .filter((_, index) => index % 2 === 0)
      .join("").length;
    return { key, names, fixedLength, pattern: new RegExp(`^${source}$`, "s") };
  })
  .sort((a, b) => b.fixedLength - a.fixedLength);

/** A message from the Rust side in the app's language. */
export function nativeText(message: string): string {
  if (exactKeys.has(message)) return t(message as NativeKey);
  for (const { key, names, pattern } of patterns) {
    const match = pattern.exec(message);
    if (!match) continue;
    const values: TOptions = {};
    names.forEach((name, index) => {
      values[name] = match[index + 1];
    });
    return t(key, values);
  }
  return message;
}
