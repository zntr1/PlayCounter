import type { Game } from "@playcounter/shared";
import { describe, expect, it } from "vitest";
import { decideCollision } from "./softwareCollision";

const vsCode: Game = {
  id: 3,
  name: "Visual Studio Code",
  coverUrl: "",
  source: "community",
  kind: "tool",
};
const code29: Game = { id: 9, name: "Code:29", coverUrl: "", source: "igdb" };
const codeRed: Game = {
  id: 10,
  name: "Code Red",
  coverUrl: "",
  source: "igdb",
};

describe("software or game on one exe", () => {
  it.each([
    ["the product names the software", { productName: "Visual Studio Code" }],
    [
      "the description names the software",
      { fileDescription: "Visual Studio Code" },
    ],
    ["case, symbols and spaces differ", { productName: "visual-studio CODE®" }],
    [
      "the other field names neither",
      { productName: "Visual Studio Code", fileDescription: "Code editor" },
    ],
  ])("is software when %s", (_label, details) => {
    expect(decideCollision(details, vsCode, [code29, codeRed])).toEqual({
      kind: "tool",
    });
  });

  it.each([
    ["the product names one game", { productName: "Code:29" }],
    ["the description names one game", { fileDescription: "CODE 29" }],
  ])("is that game when %s", (_label, details) => {
    expect(decideCollision(details, vsCode, [code29, codeRed])).toEqual({
      kind: "game",
      game: code29,
    });
  });

  it.each([
    ["no file details", null],
    ["empty file details", {}],
    ["a name matching nothing", { productName: "Notepad" }],
    [
      "both the software and a game named",
      { productName: "Visual Studio Code", fileDescription: "Code:29" },
    ],
    [
      "two games named",
      { productName: "Code:29", fileDescription: "Code Red" },
    ],
  ])("is unclear with %s", (_label, details) => {
    expect(decideCollision(details, vsCode, [code29, codeRed])).toEqual({
      kind: "unclear",
    });
  });

  it("never matches a name made only of symbols", () => {
    expect(
      decideCollision({ productName: "!!!" }, { ...vsCode, name: "???" }, [
        code29,
      ]),
    ).toEqual({ kind: "unclear" });
  });
});
