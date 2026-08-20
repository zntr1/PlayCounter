import { describe, expect, it } from "vitest";
import { emulatorShareControl, isShareableEmulatorMapping } from "./share";
import type { EmulatorMapping } from "./types";

function mapping(overrides: Partial<EmulatorMapping> = {}): EmulatorMapping {
  return {
    contentKey: "dosbox:program:doom3.exe",
    emulatorId: "dosbox",
    label: "DOSBox",
    contentKind: "program",
    contentValue: "doom3.exe",
    display: "DOOM3.EXE",
    trust: "recognized",
    decision: "game",
    gameId: 42,
    gameName: "Doom 3",
    source: "igdb",
    confidence: "user",
    shareable: true,
    decidedAt: "2026-08-20T10:00:00.000Z",
    lastSeenAt: "2026-08-20T10:00:00.000Z",
    ...overrides,
  };
}

const baseContext = {
  privateTokens: ["philip"],
  privacyReady: true,
  installUuid: "550e8400-e29b-41d4-a716-446655440000",
  offline: false,
  serverUnavailable: false,
};

describe("emulator mapping sharing", () => {
  it("fails closed for local, weak, private, and legacy identities", () => {
    for (const item of [
      mapping({ decision: "ignored" }),
      mapping({ source: "custom", gameId: -1_000_000_001 }),
      mapping({ trust: "weak" }),
      mapping({ contentKind: "folder" }),
      mapping({ contentValue: "philip-doom3.exe" }),
      mapping({ shareable: false }),
    ]) {
      expect(isShareableEmulatorMapping(item, baseContext)).toBe(false);
    }
    expect(
      isShareableEmulatorMapping(mapping({ shareable: undefined }), {
        ...baseContext,
        privacyReady: false,
      }),
    ).toBe(false);
  });

  it("shares a recognized clean database mapping", () => {
    expect(isShareableEmulatorMapping(mapping(), baseContext)).toBe(true);
    expect(emulatorShareControl(mapping(), baseContext)).toMatchObject({
      visible: true,
      action: "share",
      disabled: false,
    });
  });

  it("uses status and runtime context to drive the control", () => {
    expect(
      emulatorShareControl(mapping(), { ...baseContext, offline: true }),
    ).toMatchObject({ visible: true, disabled: true });
    for (const status of [
      "pending",
      "verified",
      "rejected",
      "already_curated",
    ] as const) {
      expect(
        emulatorShareControl(
          mapping({
            share: {
              status,
              gameId: 42,
              submittedAt: "2026-08-20T10:00:00.000Z",
            },
          }),
          baseContext,
        ),
      ).toEqual({ visible: false });
    }
  });
});
