import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const src = fileURLToPath(new URL(".", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "locales" || entry.name === "__fixtures__"
        ? []
        : sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

// docs/pause-timer-plan.md: paused time never counts. A running session's
// time is "since the start, minus the pauses"; `… - Date.parse(startedAt)`
// anywhere else forgets the pauses. A text check: it catches the usual way
// of writing it, not every possible one.
it("works out a running session's time only in sessionTime.ts", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(src)) {
    const name = relative(src, file).replaceAll("\\", "/");
    if (name === "sessionTime.ts") continue;
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(
      /-\s*Date\.parse\(\s*[\w.?]*startedAt\s*\)/g,
    )) {
      const before = text.slice(Math.max(0, match.index - 80), match.index);
      // Sorting by start: one start minus another.
      if (/Date\.parse\(\s*[\w.?]*startedAt\s*\)\s*$/.test(before)) continue;
      const line = text.slice(0, match.index).split("\n").length;
      offenders.push(`${name}:${line}`);
    }
  }
  expect(offenders).toEqual([]);
});
