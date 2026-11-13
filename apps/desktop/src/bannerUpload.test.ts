import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { STORAGE_KEY } from "./persistence";

// The file lands in the app's covers folder; the webview reads it through
// the asset protocol, the way Windows builds the URL.
const SAVED_PATH =
  "C:\\Users\\Player\\AppData\\Roaming\\com.playcounter.desktop\\covers\\banner-custom--12.png";
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) =>
    `http://asset.localhost/${encodeURIComponent(path)}`,
  invoke: vi.fn(async (command: string) =>
    command === "save_picked_banner" ? SAVED_PATH : undefined,
  ),
}));

import { useAppStore } from "./store";
import { hydrate, setPickedBannerFile } from "./tracker";

// A game IGDB does not know: a Custom game, keyed like its banner.
const KEY = "custom:-12";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let storage: Map<string, string>;

beforeEach(() => {
  vi.mocked(invoke).mockClear();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("navigator", { platform: "Win32", userAgent: "Windows" });
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  useAppStore.setState(useAppStore.getInitialState(), true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("saves an uploaded banner as its own file and uses it for the game", async () => {
  await setPickedBannerFile(
    KEY,
    new File([PNG], "my banner.png", { type: "image/png" }),
  );

  expect(invoke).toHaveBeenCalledWith(
    "save_picked_banner",
    expect.objectContaining({ key: KEY, extension: "png" }),
  );
  expect(useAppStore.getState().customHeroArt[KEY]).toMatch(
    /^http:\/\/asset\.localhost\/C%3A%5CUsers%5C.*banner-custom--12\.png\?v=\d+$/,
  );
});

it("keeps an uploaded banner after a restart", async () => {
  await setPickedBannerFile(
    KEY,
    new File([PNG], "my banner.png", { type: "image/png" }),
  );
  const uploaded = useAppStore.getState().customHeroArt[KEY];
  // The save runs right after the change.
  await Promise.resolve();
  const saved = storage.get(STORAGE_KEY);
  expect(saved).toBeDefined();

  useAppStore.setState(useAppStore.getInitialState(), true);
  storage = new Map([[STORAGE_KEY, saved!]]);
  hydrate();

  expect(useAppStore.getState().customHeroArt[KEY]).toBe(uploaded);
});

it("refuses a GIF with a banner message and saves nothing", async () => {
  await expect(
    setPickedBannerFile(
      KEY,
      new File([new Uint8Array([0x47, 0x49, 0x46])], "banner.gif", {
        type: "image/gif",
      }),
    ),
  ).rejects.toThrow("Banner image must be a PNG, JPG, or WebP file.");
  expect(invoke).not.toHaveBeenCalledWith(
    "save_picked_banner",
    expect.anything(),
  );
  expect(useAppStore.getState().customHeroArt[KEY]).toBeUndefined();
});
