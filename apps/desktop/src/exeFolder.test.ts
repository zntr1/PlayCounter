import { describe, expect, it } from "vitest";
import { describeExeFolder } from "./exeFolder";

const marked = (path: string) => {
  const folder = describeExeFolder(path);
  return {
    location: folder.gameLocation,
    markers: folder.segments.filter((s) => s.marker).map((s) => s.text),
    game: folder.segments.find((s) => s.gameFolder)?.text ?? null,
  };
};

describe("exe folder evidence", () => {
  it.each([
    [
      "D:/SteamLibrary/steamapps/common/Hades II/Hades2.exe",
      "a Steam library",
      ["steamapps", "common"],
      "Hades II",
    ],
    [
      "C:/Program Files/Epic Games/Fortnite/FortniteGame/Binaries/Win64/Fortnite.exe",
      "the Epic Games folder",
      ["Epic Games"],
      "Fortnite",
    ],
    [
      "E:/XboxGames/Starfield/Content/Starfield.exe",
      "the Xbox games folder",
      ["XboxGames"],
      "Starfield",
    ],
    [
      "C:/Program Files (x86)/GOG Galaxy/Games/Witcher 3/bin/witcher3.exe",
      "a GOG games folder",
      ["GOG Galaxy", "Games"],
      "Witcher 3",
    ],
    [
      "D:/Games/Stardew Valley/Stardew Valley.exe",
      "a folder called Games",
      ["Games"],
      "Stardew Valley",
    ],
  ])("marks the game location in %s", (path, location, markers, game) => {
    expect(marked(path)).toEqual({ location, markers, game });
  });

  it("prefers the specific location over a plain Games folder", () => {
    expect(
      marked("D:/Games/SteamLibrary/steamapps/common/Celeste/Celeste.exe")
        .location,
    ).toBe("a Steam library");
  });

  it("finds nothing for ordinary programs, and splits backslash paths", () => {
    const folder = describeExeFolder(
      String.raw`C:\Program Files\PostgreSQL\16\bin\postgres.exe`,
    );
    expect(folder.gameLocation).toBeNull();
    expect(folder.segments.map((segment) => segment.text)).toEqual([
      "C:",
      "Program Files",
      "PostgreSQL",
      "16",
      "bin",
    ]);
  });

  it("needs a game folder inside the location", () => {
    expect(marked("D:/Games/launcher.exe").location).toBeNull();
  });
});
