import type { LibraryKnownExecutable } from "@playcounter/shared";
import type { ScannedExecutable } from "./types";
import { matchesProcessPatternSet } from "../ignoredProcessPatterns";

const BLOCKED_NAMES = new Set([
  "crashreportclient.exe",
  "steam.exe",
  "steamservice.exe",
  "unins000.exe",
  "uninstall.exe",
  "unitycrashhandler32.exe",
  "unitycrashhandler64.exe",
]);

const GENERIC_BASENAMES = new Set([
  "launcher",
  "launch",
  "start",
  "play",
  "game",
  "games",
  "main",
  "run",
  "client",
  "app",
  "bootstrap",
  "update",
  "updater",
  "patcher",
  "server",
  "editor",
  "dedicated",
  "benchmark",
  "config",
  "settings",
  "sh",
  // Engine runtimes shipped unchanged with every game: RPG Maker 2000/2003
  // (RPG_RT.exe), unrenamed NW.js builds, EasyRPG Player and Pixel Game
  // Maker MV (Player.exe), unfused LÖVE games.
  "rpgrt",
  "nw",
  "player",
  "love",
  // A Java many games bring in their own folder (jre\bin\javaw.exe). A Java
  // installed once for the whole PC runs every Java game from one folder;
  // those cannot be told apart this way.
  "java",
  "javaw",
  // Game files different games ship under one name, each in its own folder:
  // visual novel engines (AdvHD.exe, SiglusEngine_Steam.exe, BGI.exe), Unreal
  // sample projects built into games unrenamed (LyraGame.exe, ShooterGame.exe,
  // VRExpPluginExample.exe), one file per series (fm.exe for Football Manager,
  // CricketCaptain.exe, xrEngine.exe for S.T.A.L.K.E.R., Wow.exe for retail
  // and every older WoW client, WowClassic.exe for each Classic flavour) and
  // unrenamed builds.
  "advhd",
  "siglusenginesteam",
  "bgi",
  "lyragame",
  "shootergame",
  "vrexppluginexample",
  "vrexppluginexamplewin64shipping",
  "fm",
  "cricketcaptain",
  "xrengine",
  "wow",
  "wowclassic",
  "windows",
  "gameclient",
]);

export function importExeCandidates(
  scanned: readonly ScannedExecutable[],
  known: readonly LibraryKnownExecutable[],
  gameName: string | null | undefined = "",
  ignoredProcesses: ReadonlySet<string> = new Set(),
) {
  const knownNames = new Set(
    known
      .filter((item) => item.platform === "windows" && item.kind === "exe")
      .map((item) => item.value.toLowerCase()),
  );
  const title = (gameName ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return scanned
    .filter(
      (item) =>
        item.fileName.toLowerCase().endsWith(".exe") &&
        (item.declared || item.sizeBytes >= 64 * 1024) &&
        !BLOCKED_NAMES.has(item.fileName.toLowerCase()) &&
        !isInstallerOrCrashExecutable(item.fileName) &&
        !matchesProcessPatternSet(item.fileName, ignoredProcesses),
    )
    .map((item) => {
      const base = item.fileName
        .slice(0, -4)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      const score =
        (item.declared ? 20_000 : 0) +
        (knownNames.has(item.fileName.toLowerCase()) ? 10_000 : 0) +
        (title && (base === title || title.includes(base)) ? 1_000 : 0) -
        item.depth * 20 -
        (GENERIC_BASENAMES.has(base) || item.depth > 3 ? 500 : 0) +
        Math.min(100, Math.floor(item.sizeBytes / 1_000_000));
      return { ...item, score };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.relativePath.localeCompare(right.relativePath),
    );
}

function isInstallerOrCrashExecutable(fileName: string) {
  const base = fileName.replace(/\.exe$/i, "").toLowerCase();
  return (
    /^(unins|uninstall|setup|install)/.test(base) ||
    base.includes("redist") ||
    base === "dxsetup" ||
    base === "dxwebsetup" ||
    base.startsWith("dotnetfx") ||
    base === "oalinst" ||
    base.startsWith("openal") ||
    base.startsWith("physx") ||
    /^ue.*prereq/.test(base) ||
    base.startsWith("crashreport") ||
    base.startsWith("crashpad") ||
    base.startsWith("crashhandler") ||
    base.startsWith("bsdiff") ||
    /^7z/.test(base) ||
    base === "dw" ||
    base.startsWith("touchup") ||
    base.startsWith("activation") ||
    base.startsWith("cleanup") ||
    base.endsWith("_eula")
  );
}

export function manualExecutableNeedsScope(executable: ScannedExecutable) {
  return isGenericExeName(executable.fileName) || executable.depth > 3;
}

/** A file name many games ship (Game.exe): it names no game on its own, so a
 *  link for it is kept to the folder it runs from. */
export function isGenericExeName(exeName: string) {
  const basename = exeName
    .replace(/\.exe$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return GENERIC_BASENAMES.has(basename);
}
