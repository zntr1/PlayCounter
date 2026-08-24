import { describe, expect, it } from "vitest";
import {
  discoverDosboxLaunchTarget,
  dosboxAdapter,
  readDosboxCommandLine,
  readDosboxTitle,
} from "./dosbox";

const context = { denylist: new Set<string>(), privateTokens: ["philip"] };

describe("DOSBox adapter", () => {
  it("prefers a game-specific conf over secondary conf files", () => {
    expect(
      readDosboxCommandLine([
        "dosbox.exe",
        "-conf",
        "C:\\DOS\\dosbox_settings.conf",
        "-conf",
        "C:\\DOS\\dosbox_DOOM.conf",
      ]),
    ).toMatchObject({
      kind: "conf",
      value: "doom",
      trust: "recognized",
      detectionSource: "launch_arguments",
    });
  });

  it("recognizes positional programs and -c launch commands", () => {
    expect(
      readDosboxCommandLine(["dosbox.exe", "C:\\GAMES\\DOOM.EXE"]),
    ).toMatchObject({
      kind: "program",
      value: "doom.exe",
      detectionSource: "launch_arguments",
    });
    expect(
      readDosboxCommandLine(["dosbox.exe", "-c", "DUKE3D.EXE -nosound"]),
    ).toMatchObject({
      kind: "program",
      value: "duke3d.exe",
      detectionSource: "launch_arguments",
    });
  });

  it("discovers a full program or game-specific config launch target", () => {
    expect(
      discoverDosboxLaunchTarget([
        "-conf",
        String.raw`C:\DOS\dosbox_settings.conf`,
        String.raw`D:\Games\Doom\DOOM.EXE`,
        "-exit",
      ]),
    ).toEqual({
      target: {
        kind: "file",
        filePath: String.raw`D:\Games\Doom\DOOM.EXE`,
      },
      source: "launch_arguments",
    });
    expect(
      discoverDosboxLaunchTarget([
        "-conf",
        String.raw`C:\DOS\dosbox_settings.conf`,
        "-conf",
        String.raw`D:\Games\Doom\dosbox_DOOM.conf`,
      ]),
    ).toEqual({
      target: {
        kind: "file",
        filePath: String.raw`D:\Games\Doom\dosbox_DOOM.conf`,
      },
      source: "launch_arguments",
    });
  });

  it("resolves relative programs against the DOSBox process working directory", () => {
    expect(
      discoverDosboxLaunchTarget(
        ["WOLF3D.EXE", "--exit"],
        String.raw`C:\Users\phili\Downloads\dosbox\wolf3d`,
      ),
    ).toEqual({
      target: {
        kind: "file",
        filePath: String.raw`C:\Users\phili\Downloads\dosbox\wolf3d\WOLF3D.EXE`,
      },
      source: "launch_arguments",
    });
  });

  it("identifies DOSBox launch files for reusable target correlation", () => {
    expect(
      dosboxAdapter.launch?.identifyTarget(
        { kind: "file", filePath: String.raw`D:\Games\Doom\DOOM.EXE` },
        context,
      ),
    ).toMatchObject({ kind: "program", value: "doom.exe" });
    expect(
      dosboxAdapter.launch?.identifyTarget(
        {
          kind: "file",
          filePath: String.raw`D:\Games\Doom\dosbox_DOOM.conf`,
        },
        context,
      ),
    ).toMatchObject({ kind: "conf", value: "doom" });
  });

  it("uses the classic Program title to follow content changes", () => {
    expect(
      readDosboxTitle(
        "DOSBox 0.74-3, Cpu speed: max 100% cycles, Frameskip 0, Program: DOOM",
      ),
    ).toMatchObject({
      kind: "program",
      value: "doom",
      trust: "recognized",
      detectionSource: "window_title",
    });
  });

  it("keeps weak titles and private tokens local", () => {
    const reading = dosboxAdapter.read(
      {
        emulatorId: "dosbox",
        exeName: "dosbox.exe",
        pid: 1,
        startedAtUnix: 2,
        args: [],
        windowTitle: "Philip - DOSBox-X",
      },
      context,
    );
    expect(reading).toMatchObject({
      state: "content",
      content: { value: "philip", trust: "weak", shareable: false },
    });
  });
});
