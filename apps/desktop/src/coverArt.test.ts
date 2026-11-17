import { describe, expect, it } from "vitest";
import type { CoverQuality } from "@playcounter/shared";
import { coverQualityOf, isIgdbImageUrl, upgradeCoverUrl } from "./coverArt";

const igdb = (size: string, file = "co2lbd.webp") =>
  `https://images.igdb.com/igdb/image/upload/${size}/${file}`;

const QUALITIES: CoverQuality[] = ["standard", "sharp", "sharpest", "original"];

describe("upgradeCoverUrl", () => {
  it("returns the URL untouched at Standard", () => {
    expect(upgradeCoverUrl(igdb("t_cover_big"), "standard")).toBe(
      igdb("t_cover_big"),
    );
  });

  it("Sharp moves an IGDB cover up one size", () => {
    expect(upgradeCoverUrl(igdb("t_cover_big"), "sharp")).toBe(
      igdb("t_cover_big_2x"),
    );
    expect(upgradeCoverUrl(igdb("t_thumb"), "sharp")).toBe(
      igdb("t_cover_big"),
    );
    expect(upgradeCoverUrl(igdb("t_cover_small"), "sharp")).toBe(
      igdb("t_cover_big"),
    );
  });

  it("Sharpest loads covers at 1080p", () => {
    expect(upgradeCoverUrl(igdb("t_cover_big"), "sharpest")).toBe(
      igdb("t_1080p"),
    );
    expect(upgradeCoverUrl(igdb("t_cover_big_2x"), "sharpest")).toBe(
      igdb("t_1080p"),
    );
  });

  it("Original loads the image at the size it was uploaded", () => {
    expect(upgradeCoverUrl(igdb("t_cover_big"), "original")).toBe(
      igdb("t_original"),
    );
    expect(upgradeCoverUrl(igdb("t_cover_big_2x"), "original")).toBe(
      igdb("t_original"),
    );
  });

  it("keeps thumbnails at card size at every level, because they show small", () => {
    for (const quality of ["sharp", "sharpest", "original"] as const) {
      expect(upgradeCoverUrl(igdb("t_thumb"), quality)).toBe(
        igdb("t_cover_big"),
      );
    }
  });

  it("keeps the file name and extension", () => {
    expect(upgradeCoverUrl(igdb("t_cover_big", "co1r7f.jpg"), "sharp")).toBe(
      igdb("t_cover_big_2x", "co1r7f.jpg"),
    );
  });

  it("leaves sizes that are not cover sizes alone", () => {
    for (const quality of QUALITIES) {
      for (const size of [
        "t_720p",
        "t_1080p",
        "t_original",
        "t_screenshot_big",
      ]) {
        expect(upgradeCoverUrl(igdb(size), quality)).toBe(igdb(size));
      }
    }
    expect(upgradeCoverUrl(igdb("t_cover_big_2x"), "sharp")).toBe(
      igdb("t_cover_big_2x"),
    );
  });

  it("never touches covers that are not served by IGDB", () => {
    const others = [
      "asset://localhost/covers/my-game.png",
      "data:image/png;base64,iVBORw0KGgo=",
      "https://example.test/igdb/image/upload/t_cover_big/co2lbd.webp",
      "https://cdn.example/t_cover_big/co2lbd.webp",
      "",
    ];
    for (const quality of QUALITIES)
      for (const url of others)
        expect(upgradeCoverUrl(url, quality)).toBe(url);
  });

  it("leaves a malformed IGDB URL alone rather than mangling it", () => {
    const noSize = "https://images.igdb.com/igdb/image/upload/co2lbd.webp";
    const empty = "https://images.igdb.com/igdb/image/upload/";
    expect(upgradeCoverUrl(noSize, "sharp")).toBe(noSize);
    expect(upgradeCoverUrl(empty, "sharp")).toBe(empty);
  });

  it("recognises IGDB image URLs", () => {
    expect(isIgdbImageUrl(igdb("t_cover_big"))).toBe(true);
    expect(isIgdbImageUrl("asset://localhost/cover.png")).toBe(false);
  });
});

describe("coverQualityOf", () => {
  it("is Standard when nothing was picked", () => {
    expect(coverQualityOf({})).toBe("standard");
    expect(coverQualityOf({ libraryHighResCovers: false })).toBe("standard");
  });

  it("is Sharp for someone who had Sharper covers on", () => {
    expect(coverQualityOf({ libraryHighResCovers: true })).toBe("sharp");
  });

  it("follows the picked quality over the old switch", () => {
    expect(
      coverQualityOf({ libraryHighResCovers: true, coverQuality: "standard" }),
    ).toBe("standard");
    expect(coverQualityOf({ coverQuality: "original" })).toBe("original");
  });
});
