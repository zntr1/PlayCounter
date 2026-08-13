import { describe, expect, it } from "vitest";
import {
  accumulateObservationRuntime,
  reconcileEmulatorReadings,
} from "./resolve";
import type { EmulatorMapping, EmulatorRuntimeState } from "./types";

const contentReading = {
  pid: 10,
  startedAtUnix: 20,
  exeName: "dosbox.exe",
  emulatorId: "dosbox",
  label: "DOSBox",
  reading: {
    state: "content" as const,
    content: {
      kind: "program" as const,
      value: "doom.exe",
      display: "DOOM.EXE",
      trust: "recognized" as const,
      shareable: true,
      volatile: true,
    },
  },
};

describe("emulator reconciliation", () => {
  it("deduplicates identical content and emits one lookup", () => {
    const result = reconcileEmulatorReadings({
      readings: [contentReading, { ...contentReading, pid: 11 }],
      observations: [],
      mappings: new Map(),
      runtime: new Map<string, EmulatorRuntimeState>(),
      now: 1_000,
      lookupEnabled: true,
      retryMs: 60_000,
    });
    expect(result.runningKeys).toEqual(new Set(["dosbox:program:doom.exe"]));
    expect(
      result.intents.filter((intent) => intent.type === "resolve"),
    ).toHaveLength(1);
  });

  it("honors local ignored decisions without resolving", () => {
    const ignored: EmulatorMapping = {
      contentKey: "dosbox:program:doom.exe",
      emulatorId: "dosbox",
      label: "DOSBox",
      contentKind: "program",
      contentValue: "doom.exe",
      display: "DOOM.EXE",
      trust: "recognized",
      decision: "ignored",
      confidence: "user",
      decidedAt: new Date(0).toISOString(),
      lastSeenAt: new Date(0).toISOString(),
    };
    const result = reconcileEmulatorReadings({
      readings: [contentReading],
      observations: [],
      mappings: new Map([[ignored.contentKey, ignored]]),
      runtime: new Map(),
      now: 1_000,
      lookupEnabled: true,
      retryMs: 60_000,
    });
    expect(result.intents).toEqual([]);
  });

  it("accumulates unresolved runtime across checkpoints and stop", () => {
    const observation = {
      kind: "content" as const,
      key: "dosbox:program:doom.exe",
      emulatorId: "dosbox",
      label: "DOSBox",
      hostExeName: "dosbox.exe",
      contentKind: "program" as const,
      contentValue: "doom.exe",
      display: "DOOM.EXE",
      trust: "recognized" as const,
      shareable: true,
      state: "unknown" as const,
      detectedAt: new Date(0).toISOString(),
      runningSince: new Date(0).toISOString(),
    };
    const checkpoint = accumulateObservationRuntime(
      [observation],
      new Set([observation.key]),
      60_000,
    )[0];
    const stopped = accumulateObservationRuntime(
      [checkpoint],
      new Set(),
      90_000,
    )[0];
    expect(stopped).toMatchObject({
      trackedSeconds: 90,
      endedAt: new Date(90_000).toISOString(),
    });
    expect("runningSince" in stopped).toBe(false);
  });
});
