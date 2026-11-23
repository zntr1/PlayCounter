// @vitest-environment happy-dom
/* The picked Cover quality reaches the <img> the webview loads. */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoverQuality } from "@playcounter/shared";
import { useAppStore } from "../store";
import { GameCover } from "./GameCover";

const igdb = (size: string) =>
  `https://images.igdb.com/igdb/image/upload/${size}/co2lbd.jpg`;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useAppStore.setState(useAppStore.getInitialState(), true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(
  quality: CoverQuality | null,
  props: { large?: boolean; highRes?: boolean } = {},
) {
  if (quality) useAppStore.getState().setCoverQuality(quality);
  await act(async () =>
    root.render(
      createElement(GameCover, { src: igdb("t_cover_big"), ...props }),
    ),
  );
  return container.querySelector("img")!;
}

describe("GameCover loads the picked cover quality", () => {
  it.each([
    ["standard", "t_cover_big"],
    ["sharp", "t_cover_big_2x"],
    ["sharpest", "t_1080p"],
    ["original", "t_original"],
  ] as const)("a large cover at %s loads %s", async (quality, size) => {
    expect((await render(quality, { large: true })).getAttribute("src")).toBe(
      igdb(size),
    );
  });

  it.each([
    ["standard", "t_cover_big"],
    ["sharp", "t_cover_big_2x"],
    ["sharpest", "t_cover_big_2x"],
    ["original", "t_cover_big_2x"],
  ] as const)(
    "a small cover at %s loads %s, never more than Sharp",
    async (quality, size) => {
      expect((await render(quality)).getAttribute("src")).toBe(igdb(size));
    },
  );

  it("loads Sharp for someone who had Sharper covers on", async () => {
    useAppStore.setState((state) => ({
      settings: { ...state.settings, libraryHighResCovers: true },
    }));
    expect((await render(null, { large: true })).getAttribute("src")).toBe(
      igdb("t_cover_big_2x"),
    );
  });

  it("loads at least Sharp where the cover shows big (details, hero)", async () => {
    const big = { large: true, highRes: true };
    expect((await render("standard", big)).getAttribute("src")).toBe(
      igdb("t_cover_big_2x"),
    );
    expect((await render("original", big)).getAttribute("src")).toBe(
      igdb("t_original"),
    );
  });

});

/* Covers fade in once loaded instead of popping in (Phil, 2026-11-22: a must
   have in every view). A cover the webview already has shows at once, so
   scrolling back or switching views doesn't fade it again. */
describe("GameCover fades a cover in once it has loaded", () => {
  it("keeps a cover hidden while it loads, then fades it in", async () => {
    const img = await render(null);
    expect(img.hasAttribute("data-img-loading")).toBe(true);

    await act(async () => {
      img.dispatchEvent(new Event("load"));
    });

    expect(img.hasAttribute("data-img-loading")).toBe(false);
    expect(img.hasAttribute("data-img-fade-in")).toBe(true);
  });

  it("shows a cover the webview already has at once, without fading", async () => {
    // happy-dom reports every image complete; a decoded one has a width.
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(
      264,
    );
    const img = await render(null);
    expect(img.hasAttribute("data-img-loading")).toBe(false);
    expect(img.hasAttribute("data-img-fade-in")).toBe(false);
    vi.restoreAllMocks();
  });

  it("drops the fade once it has played", async () => {
    const img = await render(null);
    await act(async () => {
      img.dispatchEvent(new Event("load"));
    });
    await act(async () => {
      // A real transitionend bubbles; React listens for it at the root.
      img.dispatchEvent(new Event("transitionend", { bubbles: true }));
    });
    expect(img.hasAttribute("data-img-fade-in")).toBe(false);
  });
});

describe("GameCover keeps the stored cover as a fallback", () => {
  it("falls back to the stored cover when the larger file fails", async () => {
    const img = await render("sharpest", { large: true });
    await act(async () => {
      img.dispatchEvent(new Event("error"));
    });
    expect(container.querySelector("img")!.getAttribute("src")).toBe(
      igdb("t_cover_big"),
    );
  });
});
