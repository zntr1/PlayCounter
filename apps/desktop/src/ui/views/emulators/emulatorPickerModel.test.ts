import type { EmulatorContentObservation } from "../../../emulators/types";
import { describe, expect, it } from "vitest";
import {
  emulatorDetectionSourceLabel,
  emulatorPickerCopy,
  emulatorPickerPhase,
  canShareEmulatorObservation,
  emulatorShareBadgeStatus,
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
  it("labels the actual emulator detection source", () => {
    expect(emulatorDetectionSourceLabel("window_title")).toBe("window title");
    expect(emulatorDetectionSourceLabel("launch_arguments")).toBe(
      "start-up options",
    );
    expect(emulatorDetectionSourceLabel()).toBeNull();
  });

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

  it("only offers sharing for privacy-safe observations", () => {
    expect(canShareEmulatorObservation(observation())).toBe(true);
    expect(canShareEmulatorObservation(observation({ shareable: false }))).toBe(
      false,
    );
    expect(
      canShareEmulatorObservation(observation({ contentKind: "folder" })),
    ).toBe(false);
  });

  it("maps persisted review outcomes to the standard badge", () => {
    expect(emulatorShareBadgeStatus()).toBeNull();
    expect(
      emulatorShareBadgeStatus({
        status: "pending",
        gameId: 1,
        submittedAt: "2026-08-20T10:00:00.000Z",
      }),
    ).toBe("pending");
    expect(
      emulatorShareBadgeStatus({
        status: "already_curated",
        gameId: 1,
        submittedAt: "2026-08-20T10:00:00.000Z",
      }),
    ).toBe("verified");
    expect(
      emulatorShareBadgeStatus({
        status: "rejected",
        gameId: 1,
        submittedAt: "2026-08-20T10:00:00.000Z",
      }),
    ).toBeNull();
  });
});
