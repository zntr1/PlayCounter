import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { matchesProcessPatternSet } from "./ignoredProcessPatterns";

/** The list the app ships for Windows, read as the Rust side reads it. */
const builtIn = new Set(
  readFileSync(
    fileURLToPath(
      new URL(
        "../src-tauri/resources/ignored-processes/windows.txt",
        import.meta.url,
      ),
    ),
    "utf8",
  )
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line && !line.startsWith("#")),
);

describe("built-in ignored processes", () => {
  // Starters that only launch a game; many players reported them as not a
  // game. Spelled as the games ship them.
  it.each([
    "EOSBootstrapper.exe",
    "bootstrapper.exe",
    "start_protected_game.exe",
    "EACLauncher.exe",
    "EAAntiCheat.GameServiceLauncher.exe",
  ])("hides %s", (exeName) => {
    expect(matchesProcessPatternSet(exeName, builtIn)).toBe(true);
  });

  it.each(["Game.exe", "javaw.exe", "eldenring.exe", "fm.exe"])(
    "keeps the game file %s",
    (exeName) => {
      expect(matchesProcessPatternSet(exeName, builtIn)).toBe(false);
    },
  );
});
