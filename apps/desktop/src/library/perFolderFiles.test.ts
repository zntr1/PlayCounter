// @vitest-environment happy-dom
import type { ScannedExecutable } from "./types";
import { beforeEach, describe, expect, it, vi } from "vitest";

/* docs/per-folder-list-plan.md, Desktop: the file names the admin panel marks
   "Per folder" count like the built-in shared names (Game.exe). The app saves
   the list on the PC and fetches it again at every start. */

/** The modules as a new start of the app loads them. */
async function newStart() {
  vi.resetModules();
  return {
    ...(await import("./exeCandidates")),
    ...(await import("./perFolderFiles")),
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("the per-folder list", () => {
  it("knows only the built-in names on the first start, before any request", async () => {
    const { isGenericExeName } = await newStart();

    expect(isGenericExeName("SkyrimSE.exe")).toBe(false);
    expect(isGenericExeName("Game.exe")).toBe(true);
  });

  it("counts a name from the server like a built-in one", async () => {
    const { isGenericExeName, setPerFolderFiles } = await newStart();

    setPerFolderFiles(["skyrimse.exe"]);

    expect(isGenericExeName("SkyrimSE.exe")).toBe(true);
    expect(isGenericExeName("SKYRIMSE.EXE")).toBe(true);
    expect(isGenericExeName("Skyrim.exe")).toBe(false);
  });

  it("uses the list saved at the last start before anything is fetched", async () => {
    (await newStart()).setPerFolderFiles(["skyrimse.exe"]);

    const { isGenericExeName } = await newStart();

    expect(isGenericExeName("SkyrimSE.exe")).toBe(true);
  });

  it("follows the server when Phil removes a name, now and at the next start", async () => {
    const first = await newStart();
    first.setPerFolderFiles(["skyrimse.exe", "kingdomcome.exe"]);

    first.setPerFolderFiles(["kingdomcome.exe"]);

    expect(first.isGenericExeName("SkyrimSE.exe")).toBe(false);
    expect(first.isGenericExeName("KingdomCome.exe")).toBe(true);
    const next = await newStart();
    expect(next.isGenericExeName("SkyrimSE.exe")).toBe(false);
    expect(next.isGenericExeName("KingdomCome.exe")).toBe(true);
  });

  it("returns the names that are new", async () => {
    const { setPerFolderFiles } = await newStart();

    expect(setPerFolderFiles(["skyrimse.exe"])).toEqual(["skyrimse.exe"]);
    expect(setPerFolderFiles(["skyrimse.exe", "kingdomcome.exe"])).toEqual([
      "kingdomcome.exe",
    ]);
    expect(setPerFolderFiles(["kingdomcome.exe"])).toEqual([]);
  });
});

describe("picking the Play file of an imported game", () => {
  const file = (fileName: string): ScannedExecutable => ({
    fileName,
    relativePath: fileName,
    sizeBytes: 50_000_000,
    depth: 0,
  });

  it("ranks a name from the server as low as a built-in shared name", async () => {
    const { importExeCandidates, setPerFolderFiles } = await newStart();
    setPerFolderFiles(["skyrimse.exe"]);

    const scores = Object.fromEntries(
      importExeCandidates(
        [file("SkyrimSE.exe"), file("Game.exe"), file("Tool.exe")],
        [],
        "Enderal",
      ).map((item) => [item.fileName, item.score]),
    );

    expect(scores["SkyrimSE.exe"]).toBe(scores["Game.exe"]);
    expect(scores["Tool.exe"] - scores["SkyrimSE.exe"]).toBe(500);
  });
});
