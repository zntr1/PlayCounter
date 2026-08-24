import { describe, expect, it } from "vitest";
import { toPublicSnapshots } from "./publicProjection";

describe("emulator public projection", () => {
  it("removes private signals and collapses identical hosts", () => {
    const result = toPublicSnapshots([
      {
        exeName: "dosbox.exe",
        exePath: null,
        emulatorId: "dosbox",
        pid: 1,
        commandLine: ["secret"],
        workingDirectory: String.raw`C:\Private`,
        windowTitle: "secret",
        openFiles: [String.raw`C:\Private\Game.rvz`],
      },
      {
        exeName: "dosbox.exe",
        exePath: null,
        emulatorId: "dosbox",
        pid: 2,
        commandLine: ["other"],
        windowTitle: "other",
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty("commandLine");
    expect(result[0]).not.toHaveProperty("workingDirectory");
    expect(result[0]).not.toHaveProperty("windowTitle");
    expect(result[0]).not.toHaveProperty("openFiles");
  });
});
