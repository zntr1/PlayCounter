import { describe, expect, it } from "vitest";
import {
  discoverDolphinLaunchTarget,
  dolphinAdapter,
  readDolphinCommandLine,
  readDolphinTitle,
} from "./dolphin";

const context = { denylist: new Set<string>(), privateTokens: ["philip"] };

describe("Dolphin adapter", () => {
  it("discovers the exact game file from Dolphin launch arguments", () => {
    expect(
      discoverDolphinLaunchTarget([
        "--exec",
        String.raw`D:\GameCube\The Sims 2.rvz`,
      ]),
    ).toEqual({
      target: {
        kind: "file",
        filePath: String.raw`D:\GameCube\The Sims 2.rvz`,
      },
      source: "launch_arguments",
    });
    expect(discoverDolphinLaunchTarget(["--exec=relative-game.rvz"])).toEqual({
      target: { kind: "file", filePath: "relative-game.rvz" },
      source: "launch_arguments",
    });
    expect(discoverDolphinLaunchTarget(["--exec=memory-card.raw"])).toBeNull();
  });

  it("discovers a game opened later through Dolphin's file handle", () => {
    expect(
      discoverDolphinLaunchTarget([], [
        String.raw`D:\GameCube\The Sims 2.rvz`,
      ]),
    ).toEqual({
      target: {
        kind: "file",
        filePath: String.raw`D:\GameCube\The Sims 2.rvz`,
      },
      source: "open_file_handle",
    });
    expect(
      discoverDolphinLaunchTarget([], [
        String.raw`D:\GameCube\Disc 1.rvz`,
        String.raw`D:\GameCube\Disc 2.rvz`,
      ]),
    ).toBeNull();
  });

  it.each([
    [
      ["--exec=C:\\Games\\Super Mario Sunshine.rvz"],
      "super mario sunshine.rvz",
    ],
    [["-e", "D:\\Wii\\Mario Kart Wii.wbfs"], "mario kart wii.wbfs"],
    [["Dolphin.exe", "C:\\Games\\F-Zero GX.iso"], "f-zero gx.iso"],
    [["-e", "D:\\Games\\Luigi's Mansion.rvz"], "luigi's mansion.rvz"],
  ])("recognizes Dolphin content files", (args, value) => {
    expect(readDolphinCommandLine(args)).toMatchObject({
      kind: "rom",
      value,
      trust: "recognized",
      volatile: false,
      detectionSource: "launch_arguments",
    });
  });

  it("uses a NAND title ID as the strongest identity", () => {
    expect(
      readDolphinCommandLine([
        "--exec=ignored.iso",
        "--nand_title=0001000148415858",
      ]),
    ).toMatchObject({
      kind: "title_id",
      value: "0001000148415858",
      display: "0001000148415858",
    });
  });

  it("rejects malformed IDs, unsupported files, and generic filenames", () => {
    expect(
      readDolphinCommandLine([
        "-n",
        "private-user-id",
        "--exec=valid-game.rvz",
      ]),
    ).toMatchObject({ value: "valid-game.rvz" });
    expect(readDolphinCommandLine(["-n", "private-user-id"])).toBeNull();
    expect(readDolphinCommandLine(["--exec=save.sav"])).toBeNull();
    expect(readDolphinCommandLine(["--exec=C:\\Games\\game.iso"])).toBeNull();
  });

  it("recognizes idle and anchored game titles", () => {
    expect(readDolphinTitle("Dolphin 2603")).toEqual({ idle: true });
    expect(
      readDolphinTitle(
        "Dolphin 2606 | JIT64 SC | Direct3D 11 | HLE | The Sims 2: Pets (G4OP69)",
      ),
    ).toMatchObject({
      kind: "title_id",
      value: "g4op69",
      display: "The Sims 2: Pets",
      trust: "recognized",
      volatile: true,
      searchHint: "The Sims 2: Pets",
      shareableSearchHint: true,
      detectionSource: "window_title",
    });
    expect(
      readDolphinTitle("Super Mario Galaxy | Dolphin 2603 | Vulkan | HLE"),
    ).toMatchObject({
      kind: "rom",
      value: "super mario galaxy",
      trust: "weak",
      volatile: true,
      detectionSource: "window_title",
    });
  });

  it("does not parse arbitrary or status-only window titles", () => {
    expect(readDolphinTitle("Philip's private window")).toBeNull();
    expect(readDolphinTitle("Dolphin 2603 | Vulkan | 60 FPS")).toBeNull();
  });

  it("shares recognized filenames but keeps title-only observations local", () => {
    expect(
      dolphinAdapter.read(
        {
          emulatorId: "dolphin",
          exeName: "dolphin.exe",
          pid: 1,
          startedAtUnix: 2,
          args: ["--exec=C:\\Games\\Metroid Prime.rvz"],
          windowTitle: null,
        },
        context,
      ),
    ).toMatchObject({
      state: "content",
      content: { value: "metroid prime.rvz", shareable: true },
    });
    expect(
      dolphinAdapter.read(
        {
          emulatorId: "dolphin",
          exeName: "dolphin.exe",
          pid: 1,
          startedAtUnix: 2,
          args: [],
          windowTitle: "Philip | Dolphin 2603",
        },
        context,
      ),
    ).toMatchObject({
      state: "content",
      content: { value: "philip", trust: "weak", shareable: false },
    });
  });

  it("prefers Dolphin's running game ID over a launch filename", () => {
    expect(
      dolphinAdapter.read(
        {
          emulatorId: "dolphin",
          exeName: "dolphin.exe",
          pid: 1,
          startedAtUnix: 2,
          args: ["--exec=C:\\Games\\The Sims 2 Pets.rvz"],
          windowTitle:
            "Dolphin 2606 | JIT64 SC | Direct3D 11 | HLE | The Sims 2: Pets (G4OP69)",
        },
        context,
      ),
    ).toMatchObject({
      state: "content",
      content: {
        kind: "title_id",
        value: "g4op69",
        display: "The Sims 2: Pets",
        shareable: true,
        searchHint: "The Sims 2: Pets",
        shareableSearchHint: true,
        detectionSource: "window_title",
      },
    });
  });

  it("does not share a recognized title containing a private token", () => {
    expect(
      dolphinAdapter.read(
        {
          emulatorId: "dolphin",
          exeName: "dolphin.exe",
          pid: 1,
          startedAtUnix: 2,
          args: [],
          windowTitle:
            "Dolphin 2606 | JIT64 SC | Vulkan | HLE | Philip's Mod (ABC123)",
        },
        context,
      ),
    ).toMatchObject({
      state: "content",
      content: {
        value: "abc123",
        shareable: true,
        shareableSearchHint: false,
      },
    });
  });
});
