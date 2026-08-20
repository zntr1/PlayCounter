import type { EmulatorContentObservation } from "../../../emulators/types";
import { describe, expect, it } from "vitest";
import {
  emulatorPickerCopy,
  emulatorPickerPhase,
  guestPlatformLabel,
} from "./emulatorPickerModel";

function observation(
  overrides: Partial<EmulatorContentObservation> = {},
): EmulatorContentObservation {
  return {
    kind: "content",
    key: "dosbox:game",
    emulatorId: "dosbox",
    label: "DOSBox",
    hostExeName: "dosbox.exe",
    contentKind: "program",
    contentValue: "GAME.EXE",
    display: "GAME.EXE",
    trust: "recognized",
    shareable: true,
    state: "unknown",
    detectedAt: "2026-08-20T10:00:00.000Z",
    ...overrides,
  };
}

describe("emulator picker model", () => {
  it("uses a helpful guest-platform label", () => {
    expect(guestPlatformLabel("dolphin")).toBe("GameCube / Wii");
    expect(guestPlatformLabel("dosbox")).toBe("DOS");
    expect(guestPlatformLabel("other")).toBe("emulator");
  });

  it("derives resolving, candidate and search phases", () => {
    expect(emulatorPickerPhase(observation({ state: "resolving" }))).toBe(
      "resolving",
    );
    expect(
      emulatorPickerPhase(
        observation({
          state: "ambiguous",
          candidates: [{ id: 1, name: "Game", coverUrl: "", source: "igdb" }],
        }),
      ),
    ).toBe("candidates");
    expect(emulatorPickerPhase(observation())).toBe("search");
  });

  it("uses warning copy only after the emulator stopped", () => {
    expect(emulatorPickerCopy(observation(), "DOS").tone).toBe("accent");
    const stopped = emulatorPickerCopy(
      observation({ endedAt: "2026-08-20T11:00:00.000Z" }),
      "DOS",
    );
    expect(stopped.tone).toBe("warning");
    expect(stopped.description).toContain("stopped");
  });
});
