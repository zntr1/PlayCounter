import { describe, expect, it } from "vitest";
import {
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
    ).toMatchObject({ kind: "conf", value: "doom", trust: "recognized" });
  });

  it("recognizes positional programs and -c launch commands", () => {
    expect(
      readDosboxCommandLine(["dosbox.exe", "C:\\GAMES\\DOOM.EXE"]),
    ).toMatchObject({ kind: "program", value: "doom.exe" });
    expect(
      readDosboxCommandLine(["dosbox.exe", "-c", "DUKE3D.EXE -nosound"]),
    ).toMatchObject({ kind: "program", value: "duke3d.exe" });
  });

  it("uses the classic Program title to follow content changes", () => {
    expect(
      readDosboxTitle(
        "DOSBox 0.74-3, Cpu speed: max 100% cycles, Frameskip 0, Program: DOOM",
      ),
    ).toMatchObject({ kind: "program", value: "doom", trust: "recognized" });
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
