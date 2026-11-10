import { describe, expect, it } from "vitest";
import { bluestacksAdapter } from "./bluestacks";
import { adapterFor, isEmulatorExe } from "./registry";
import { contentKey } from "./signals";
import type { RawEmulatorSignals } from "./types";

const context = { denylist: new Set<string>(), privateTokens: ["philip"] };

type App = NonNullable<RawEmulatorSignals["foregroundApp"]>;

// What the scanner read on 2026-11-10 (BlueStacks 5.22.290) while Subway
// Surfers was in front: the package from Player.log, name and category from
// AppCache.json.
const SUBWAY: App = {
  package: "com.kiloo.subwaysurf",
  label: "Subway Surf",
  category: "Arcade",
};

function read(foregroundApp?: App, windowTitle: string | null = null) {
  return bluestacksAdapter.read(
    {
      emulatorId: "bluestacks",
      exeName: "HD-Player.exe",
      pid: 29836,
      startedAtUnix: 1,
      args: [],
      windowTitle,
      foregroundApp,
    },
    context,
  );
}

function content(foregroundApp: App) {
  const reading = read(foregroundApp);
  if (reading.state !== "content") throw new Error(reading.state);
  return reading.content;
}

describe("BlueStacks adapter", () => {
  it("identifies the game in front by its package", () => {
    expect(read(SUBWAY)).toEqual({
      state: "content",
      content: {
        kind: "title_id",
        value: "com.kiloo.subwaysurf",
        display: "Subway Surf",
        trust: "recognized",
        shareable: true,
        volatile: true,
        detectionSource: "activity_log",
        searchHint: "Subway Surf",
        shareableSearchHint: true,
      },
    });
  });

  it("keeps the package as BlueStacks writes it, and one key for every spelling", () => {
    const genshin = content({
      package: "com.miHoYo.GenshinImpact",
      label: "Genshin Impact",
      category: "Adventure",
    });
    expect(genshin.value).toBe("com.miHoYo.GenshinImpact");
    expect(
      contentKey({
        emulatorId: "bluestacks",
        contentKind: genshin.kind,
        contentValue: genshin.value,
      }),
    ).toBe("bluestacks:title_id:com.mihoyo.genshinimpact");
  });

  it("shows the package when the app list has no name for it", () => {
    expect(read({ package: "com.kiloo.subwaysurf" })).toEqual({
      state: "content",
      content: {
        kind: "title_id",
        value: "com.kiloo.subwaysurf",
        display: "com.kiloo.subwaysurf",
        trust: "recognized",
        shareable: true,
        volatile: true,
        detectionSource: "activity_log",
        searchHint: undefined,
        shareableSearchHint: false,
      },
    });
    expect(
      read({ package: "com.kiloo.subwaysurf", label: null, category: null }),
    ).toEqual(read({ package: "com.kiloo.subwaysurf" }));
  });

  it("keeps counting while BlueStacks is minimized", () => {
    // Minimized or not, the scanner reports the same app; the window is not
    // part of the reading.
    expect(read(SUBWAY, null)).toEqual(read(SUBWAY, "BlueStacks App Player"));
    expect(read(SUBWAY, null).state).toBe("content");
  });

  // Every package Player.log named that day besides the game, plus Android's
  // own "android" and two Google apps.
  it.each([
    "com.uncube.launcher3",
    "com.bluestacks.gamecenter",
    "com.bluestacks.home",
    "com.android.vending",
    "com.android.systemui",
    "com.uncube.gamevantage",
    "android",
    "com.google.android.gms",
    "com.google.android.youtube",
  ])("is idle while %s is in front", (packageName) => {
    expect(read({ package: packageName })).toEqual({ state: "idle" });
  });

  it.each([
    ["com.netflix.mediaclient", "Netflix", "Entertainment"],
    ["org.videolan.vlc", "VLC", "Video Players & Editors"],
    ["org.mozilla.firefox", "Firefox", "Communication"],
    ["com.spotify.music", "Spotify", "Music & Audio"],
    ["com.duolingo", "Duolingo", "Education"],
    ["com.cpuid.cpu_z", "CPU-Z", "Tools"],
    ["com.cpuid.cpu_z", "CPU-Z", " tools "],
  ])("does not count %s (%s, %s)", (packageName, label, category) => {
    expect(read({ package: packageName, label, category })).toEqual({
      state: "idle",
    });
  });

  it.each([
    // Play's game categories.
    "Arcade",
    "Role Playing",
    "Casual",
    // Game categories one word away from an app category.
    "Music",
    "Educational",
    // Games and apps share this one.
    "Sports",
    // A name PlayCounter does not know, like a translated one.
    "Rollenspiele",
    "",
  ])("counts an app with the category %j", (category) => {
    expect(
      read({ package: "com.example.game", label: "Game", category }).state,
    ).toBe("content");
  });

  it.each([
    "com.androidgames.runner",
    "com.uncubed.puzzle",
    "com.bluestacksfan.quiz",
    "androidx.game",
  ])("counts %s, which only looks like a system package", (packageName) => {
    expect(read({ package: packageName }).state).toBe("content");
  });

  it("is unidentified without a line in BlueStacks' log", () => {
    expect(read(undefined)).toEqual({
      state: "unidentified",
      reason: "no-signal",
    });
  });

  it("keeps a package and a name with a private token on this PC", () => {
    const ownGame = content({ package: "com.philip.mygame", label: "My Game" });
    expect(ownGame.shareable).toBe(false);
    expect(ownGame.shareableSearchHint).toBe(false);

    const named = content({
      package: "com.example.game",
      label: "Philip's Game",
    });
    expect(named.shareable).toBe(true);
    expect(named.searchHint).toBe("Philip's Game");
    expect(named.shareableSearchHint).toBe(false);
  });

  it("keeps a package the API would refuse on this PC", () => {
    // The API takes 2 to 96 characters that start with a letter or digit.
    const long = `com.example.${"a".repeat(85)}`;
    expect(long).toHaveLength(97);
    expect(content({ package: long }).shareable).toBe(false);
    expect(content({ package: long.slice(0, 96) }).shareable).toBe(true);
    expect(content({ package: "_hidden.game" }).shareable).toBe(false);
  });

  it("has no Play button yet", () => {
    expect(bluestacksAdapter.launch).toBeUndefined();
  });

  it("is registered as the Android emulator behind HD-Player.exe", () => {
    expect(adapterFor("bluestacks")).toBe(bluestacksAdapter);
    expect(bluestacksAdapter.label).toBe("BlueStacks");
    expect(bluestacksAdapter.platformLabel).toBe("Android");
    expect(isEmulatorExe("HD-Player.exe")).toBe(true);
    expect(isEmulatorExe("HD-Adb.exe")).toBe(false);
  });
});
