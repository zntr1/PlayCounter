import { describe, expect, it } from "vitest";
import { isIgdbImageUrl, upgradeCoverUrl } from "./coverArt";

const igdb = (size: string, file = "co2lbd.webp") =>
  `https://images.igdb.com/igdb/image/upload/${size}/${file}`;

describe("upgradeCoverUrl", () => {
  it("returns the URL untouched while the setting is off", () => {
    expect(upgradeCoverUrl(igdb("t_cover_big"), false)).toBe(
      igdb("t_cover_big"),
    );
  });

  it("moves an IGDB cover up one size", () => {
    expect(upgradeCoverUrl(igdb("t_cover_big"), true)).toBe(
      igdb("t_cover_big_2x"),
    );
    expect(upgradeCoverUrl(igdb("t_thumb"), true)).toBe(igdb("t_cover_big"));
    expect(upgradeCoverUrl(igdb("t_cover_small"), true)).toBe(
      igdb("t_cover_big"),
    );
  });

  it("keeps the file name and extension", () => {
    expect(upgradeCoverUrl(igdb("t_cover_big", "co1r7f.jpg"), true)).toBe(
      igdb("t_cover_big_2x", "co1r7f.jpg"),
    );
  });

  it("leaves sizes with no larger variant alone", () => {
    for (const size of [
      "t_cover_big_2x",
      "t_720p",
      "t_1080p",
      "t_screenshot_big",
    ]) {
      expect(upgradeCoverUrl(igdb(size), true)).toBe(igdb(size));
    }
  });

  it("never touches covers that are not served by IGDB", () => {
    const others = [
      "asset://localhost/covers/my-game.png",
      "data:image/png;base64,iVBORw0KGgo=",
      "https://example.test/igdb/image/upload/t_cover_big/co2lbd.webp",
      "https://cdn.example/t_cover_big/co2lbd.webp",
      "",
    ];
    for (const url of others) expect(upgradeCoverUrl(url, true)).toBe(url);
  });

  it("leaves a malformed IGDB URL alone rather than mangling it", () => {
    const noSize = "https://images.igdb.com/igdb/image/upload/co2lbd.webp";
    const empty = "https://images.igdb.com/igdb/image/upload/";
    expect(upgradeCoverUrl(noSize, true)).toBe(noSize);
    expect(upgradeCoverUrl(empty, true)).toBe(empty);
  });

  it("recognises IGDB image URLs", () => {
    expect(isIgdbImageUrl(igdb("t_cover_big"))).toBe(true);
    expect(isIgdbImageUrl("asset://localhost/cover.png")).toBe(false);
  });
});
