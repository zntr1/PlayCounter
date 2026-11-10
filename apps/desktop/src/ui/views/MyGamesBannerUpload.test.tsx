// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { customHeroArtKey, useAppStore } from "../../store";
import { setPickedBannerFile } from "../../tracker";
import { useLibrarySources } from "../librarySources";
import { LibraryTestShell } from "./libraryTestShell";

vi.mock("../../tracker");
vi.mock("../../platform", () => ({ currentPlatform: () => "windows" }));
// IGDB knows nothing about the game: no artwork, no screenshots.
vi.mock("../../gameDetails", () => ({
  useGameDetails: () => ({ status: "empty" }),
}));

/* Discord report, 2026-11-10: a game that is not on IGDB could not get a
   banner. SteamGridDB rarely has such games either, so the banner can be
   uploaded or pasted like a cover. */

const DATE = "2026-11-10T10:00:00.000Z";
const COVER = "/tiny-indie-cover.png";
const UPLOADED =
  "http://asset.localhost/C%3A%5CUsers%5CPlayer%5CAppData%5CRoaming%5Ccom.playcounter.desktop%5Ccovers%5Cbanner-custom--12.png?v=1";
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  // Images that failed in an earlier test are forgotten, as when the
  // network comes back.
  window.dispatchEvent(new Event("online"));
  useAppStore.setState(useAppStore.getInitialState(), true);
  useLibrarySources.setState(useLibrarySources.getInitialState(), true);
  useAppStore.setState({
    activeView: "games",
    settings: {
      ...useAppStore.getState().settings,
      libraryShowShelves: false,
      libraryShowNewRow: false,
    },
  });
  // A Custom game: its .exe is the user's own, IGDB has no entry.
  useAppStore.getState().setExeCacheEntry({
    exeName: "TinyIndie.exe",
    state: "matched",
    gameId: -12,
    gameName: "Tiny Indie Game",
    coverUrl: COVER,
    source: "custom",
    identifierSource: "custom",
    lastCheckedAt: DATE,
  });
  // The real upload stores the saved file as the game's banner.
  vi.mocked(setPickedBannerFile).mockImplementation(async (key) => {
    useAppStore.getState().setCustomHeroArt(key, UPLOADED);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const card = () => container.querySelector(".game-library-card")!;
const buttonNamed = (label: string) =>
  [...document.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === label,
  );
/** The wide art of the library banner, when it shows one. */
const bannerArt = () =>
  container.querySelector<HTMLImageElement>(".library-hero img.library-hero-art");

async function appearanceAction(label: string) {
  await act(() =>
    card().dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      }),
    ),
  );
  const appearance = buttonNamed("Appearance");
  expect(appearance, "missing Appearance").toBeDefined();
  await act(async () => appearance!.click());
  const action = buttonNamed(label);
  expect(action, `missing ${label}`).toBeDefined();
  await act(async () => action!.click());
}

it("Upload banner puts the picked file in the game's banner", async () => {
  let picker: HTMLInputElement | undefined;
  vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(
    function (this: HTMLInputElement) {
      picker = this;
    },
  );
  await act(() => root.render(<LibraryTestShell />));
  expect(bannerArt()).toBeNull();

  await appearanceAction("Upload banner");
  expect(picker, "no file picker opened").toBeDefined();
  expect(picker!.accept).toBe("image/png,image/jpeg,image/webp");
  const file = new File(["png"], "banner.png", { type: "image/png" });
  Object.defineProperty(picker!, "files", { value: [file], configurable: true });
  await act(async () =>
    picker!.dispatchEvent(new Event("change", { bubbles: true })),
  );

  expect(setPickedBannerFile).toHaveBeenCalledWith(expect.any(String), file);
  expect(bannerArt()?.getAttribute("src")).toBe(UPLOADED);
  expect(useAppStore.getState().toasts[0]?.detail).toBe(
    "Tiny Indie Game now uses the selected banner.",
  );
});

it("Paste banner puts the copied image in the game's banner", async () => {
  const image = new Blob(["png"], { type: "image/png" });
  Object.defineProperty(navigator, "clipboard", {
    value: {
      read: async () => [
        { types: ["text/html", "image/png"], getType: async () => image },
      ],
    },
    configurable: true,
  });
  await act(() => root.render(<LibraryTestShell />));

  await appearanceAction("Paste banner");

  expect(setPickedBannerFile).toHaveBeenCalledWith(expect.any(String), image);
  expect(bannerArt()?.getAttribute("src")).toBe(UPLOADED);
});

it("Paste banner without an image on the clipboard says so", async () => {
  Object.defineProperty(navigator, "clipboard", {
    value: {
      read: async () => [{ types: ["text/plain"], getType: async () => null }],
    },
    configurable: true,
  });
  await act(() => root.render(<LibraryTestShell />));

  await appearanceAction("Paste banner");

  expect(setPickedBannerFile).not.toHaveBeenCalled();
  expect(useAppStore.getState().toasts[0]?.detail).toBe(
    "Copy an image, then try Paste banner again.",
  );
});

// A backup restored on another PC brings the banner's address, not its file.
it("falls back to the automatic banner when the uploaded file is gone", async () => {
  useAppStore
    .getState()
    .setCustomHeroArt(customHeroArtKey({ gameId: -12, source: "custom" }), UPLOADED);
  await act(() => root.render(<LibraryTestShell />));
  expect(bannerArt()?.getAttribute("src")).toBe(UPLOADED);

  await act(async () => bannerArt()!.dispatchEvent(new Event("error")));

  // No wide art left: the cover stands in, as for any game without a banner.
  expect(bannerArt()).toBeNull();
  expect(
    container
      .querySelector(".library-hero img.hero-backdrop")
      ?.getAttribute("src"),
  ).toBe(COVER);
});
