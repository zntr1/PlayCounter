import { describe, expect, it } from "vitest";
import {
  discoverPcsx2LaunchTarget,
  isPcsx2IdleTitle,
  pcsx2Adapter,
} from "./pcsx2";
import { adapterFor } from "./registry";
import {
  reconcileEmulatorReadings,
  accumulateObservationRuntime,
} from "./resolve";
import { toPublicSnapshots } from "./publicProjection";
import type {
  EmulatorMapping,
  EmulatorRuntimeState,
  RawEmulatorSignals,
} from "./types";
import {
  isValidEmulatorBinaryPath,
  emulatorTargetCompatibility,
} from "../emulatorLaunch";

const context = { denylist: new Set<string>(), privateTokens: ["philip"] };
const host: RawEmulatorSignals = {
  emulatorId: "pcsx2",
  exeName: "pcsx2-qt.exe",
  pid: 10,
  startedAtUnix: 20,
  args: [],
  windowTitle: null,
};
const disc = String.raw`D:\PS2\Final Fantasy X (USA).chd`;
const read = (overrides: Partial<RawEmulatorSignals>) =>
  pcsx2Adapter.read({ ...host, ...overrides }, context);

describe("PCSX2 detection", () => {
  it("registers PCSX2 and validates exact host variants", () => {
    expect(adapterFor("PCSX2")).toBe(pcsx2Adapter);
    for (const name of [
      "PCSX2-QT.exe",
      "pcsx2-qtx64.exe",
      "pcsx2-qtx64-avx2.exe",
      "pcsx2.exe",
    ]) {
      expect(isValidEmulatorBinaryPath("pcsx2", `C:\\Emulators\\${name}`)).toBe(
        true,
      );
    }
    for (const path of [
      "pcsx2-qt.exe",
      String.raw`C:\pcsx2-updater.exe`,
      String.raw`C:\notpcsx2.exe`,
    ]) {
      expect(isValidEmulatorBinaryPath("pcsx2", path)).toBe(false);
    }
  });

  it.each([
    "iso",
    "bin",
    "img",
    "mdf",
    "CHD",
    "cso",
    "zso",
    "gz",
    "iso.gz",
    "elf",
  ])("reads a loaded %s file without exposing its path", (extension) => {
    expect(
      read({
        openFiles: [`C:\\Users\\Philip\\PS2\\Final Fantasy X.${extension}`],
        windowTitle: "Private custom game title",
      }),
    ).toMatchObject({
      state: "content",
      content: {
        kind: "rom",
        value: `final fantasy x.${extension.toLowerCase()}`,
        shareable: true,
        volatile: true,
        detectionSource: "open_file_handle",
      },
    });
  });

  it.each([
    ["-batch", "-fullscreen", "--", disc],
    ["-state", "2", "-statefile", "private.p2s", disc],
    ["-datapath", "C:\\Settings.iso", "-logfile", "C:\\Log.chd", disc],
    [
      "--cfgpath=C:\\Settings.iso",
      "--cfg",
      "private.chd",
      "--fullscreen",
      disc,
    ],
  ])("parses boot arguments and skips option values: %j", (...args) => {
    expect(read({ args })).toMatchObject({
      state: "content",
      content: {
        value: "final fantasy x (usa).chd",
        detectionSource: "launch_arguments",
      },
    });
  });

  it("handles unquoted filename segments and an ELF override", () => {
    expect(
      read({ args: ["-batch", "D:\\PS2\\Final", "Fantasy", "X.chd"] }),
    ).toMatchObject({
      state: "content",
      content: { value: "final fantasy x.chd" },
    });
    expect(
      read({ args: ["-elf", String.raw`D:\PS2\Homebrew.elf`, disc] }),
    ).toMatchObject({ state: "content", content: { value: "homebrew.elf" } });
  });

  it.each([
    ["-bios", disc],
    ["--nodisc", disc],
    ["-disc", "D:"],
    ["-statefile", disc],
    ["-datapath", disc],
    ["-elf"],
    ["-unknown", disc],
    ["-help", disc],
    ["--exec", disc],
  ])("does not mistake a non-game argument for content: %j", (...args) => {
    expect(read({ args }).state).toBe("unidentified");
  });

  it.each([
    "PCSX2",
    "PCSX2 v2.4.0",
    "PCSX2 v2.7.123 [Devel]",
    "PCSX2 v1.7.5000",
    "PS2 BIOS (Europe)",
  ])("recognizes idle/BIOS %s despite stale boot arguments", (windowTitle) => {
    expect(isPcsx2IdleTitle(windowTitle)).toBe(true);
    expect(read({ windowTitle, args: [disc] })).toEqual({ state: "idle" });
  });

  it("uses the current file when the separate PCSX2 main window is idle", () => {
    expect(
      read({
        windowTitle: "PCSX2 v2.4.0",
        openFiles: [disc],
        args: ["old game.iso"],
      }),
    ).toMatchObject({
      state: "content",
      content: { value: "final fantasy x (usa).chd" },
    });
    expect(
      read({ windowTitle: "PS2 BIOS (Europe)", openFiles: [disc] }),
    ).toEqual({ state: "idle" });
  });

  it("never resurrects the launch game after a successful empty or ambiguous scan", () => {
    for (const openFiles of [[], [disc, "other game.iso"], ["bios.bin"]]) {
      const signals = { ...host, args: [disc], openFiles };
      expect(discoverPcsx2LaunchTarget(signals)).toBeNull();
      expect(pcsx2Adapter.read(signals, context).state).toBe("unidentified");
    }
  });

  it("deduplicates handles to the same file", () => {
    expect(read({ openFiles: [disc, disc.toUpperCase()] }).state).toBe(
      "content",
    );
  });

  it("ignores PCSX2 renderer caches beside the live game disc", () => {
    expect(
      read({
        openFiles: [
          String.raw`C:\PCSX2\cache\d3d12_pipelines_sm51.bin`,
          "Need for Speed - Underground 2 (Europe) (En,Fr,De,Es,It,Nl,Sv,Da) (v2.00).iso",
          String.raw`C:\Moved-cache\d3d12_shaders_sm51.bin`,
        ],
      }),
    ).toMatchObject({
      state: "content",
      content: {
        value:
          "need for speed - underground 2 (europe) (en,fr,de,es,it,nl,sv,da) (v2.00).iso",
      },
    });
    expect(
      read({
        openFiles: ["d3d12_pipelines_sm51.bin", "d3d12_shaders_sm51.bin"],
      }).state,
    ).toBe("unidentified");
  });

  it("rejects multiple boot paths instead of interpreting the second basename", () => {
    expect(read({ args: [disc, String.raw`D:\PS2\Other.iso`] }).state).toBe(
      "unidentified",
    );
  });

  it("can still use a short serial when a descriptive dump filename exceeds the identity limit", () => {
    expect(
      read({ openFiles: [`${"Long title ".repeat(10)}[SLUS-20312].chd`] }),
    ).toMatchObject({ state: "content", content: { value: "slus-20312" } });
  });

  it.each([
    "game.chd",
    "default.iso.gz",
    "bios.bin",
    "SCPH-70004_BIOS.bin",
    "PS2_BIOS.bin",
    "memory.ps2",
    "save.p2s",
    "dump.gs",
    String.raw`D:\bios\custom.bin`,
    String.raw`D:\memcards\card.bin`,
  ])("rejects generic or non-game file %s", (file) => {
    expect(read({ openFiles: [file] }).state).toBe("unidentified");
  });

  it("does not derive identities or search hints from arbitrary titles", () => {
    expect(read({ windowTitle: "Philip's window [SLUS-20312]" }).state).toBe(
      "unidentified",
    );
    const result = read({
      openFiles: [disc],
      windowTitle: String.raw`C:\Users\Philip\Private`,
    });
    expect(JSON.stringify(result)).not.toContain("Philip");
  });

  it.each(["SLUS-20312", "SLUS_203.12", "slus20312"])(
    "normalizes filename serial %s",
    (serial) => {
      expect(
        read({ openFiles: [`D:\\PS2\\Final Fantasy X (USA) [${serial}].chd`] }),
      ).toMatchObject({
        state: "content",
        content: {
          kind: "title_id",
          value: "slus-20312",
          searchHint: "Final Fantasy X (USA)",
          shareable: true,
          shareableSearchHint: true,
        },
      });
    },
  );

  it("keeps a private filename local and a private name out of a serial lookup", () => {
    expect(read({ openFiles: ["Philip's game.chd"] })).toMatchObject({
      state: "content",
      content: { shareable: false },
    });
    expect(
      read({ openFiles: ["Philip's game [SLUS-20312].chd"] }),
    ).toMatchObject({
      state: "content",
      content: {
        value: "slus-20312",
        shareable: true,
        shareableSearchHint: false,
      },
    });
  });

  it("requires the same identity before associating a launch target", () => {
    const mapping = {
      contentKind: "title_id",
      contentValue: "slus-20312",
      emulatorId: "pcsx2",
    } as EmulatorMapping;
    expect(
      emulatorTargetCompatibility(
        mapping,
        String.raw`D:\PS2\FFX [SLUS-20312].iso`,
      ),
    ).toEqual({ valid: true, association: "proven" });
    expect(
      emulatorTargetCompatibility(
        mapping,
        String.raw`D:\PS2\Other [SLUS-99999].iso`,
      ).valid,
    ).toBe(false);
    expect(
      emulatorTargetCompatibility(mapping, String.raw`D:\PS2\Unknown.iso`)
        .valid,
    ).toBe(false);
  });

  it("strips every raw PCSX2 signal from public snapshots", () => {
    const [snapshot] = toPublicSnapshots([
      {
        ...host,
        exePath: null,
        commandLine: [disc],
        workingDirectory: "private",
        windowTitle: "private",
        openFiles: [disc],
      },
    ]);
    for (const key of [
      "commandLine",
      "workingDirectory",
      "windowTitle",
      "openFiles",
    ])
      expect(snapshot).not.toHaveProperty(key);
  });
});

describe("PCSX2 lifecycle", () => {
  const reading = (file: string, pid = 10) => ({
    pid,
    startedAtUnix: 20,
    exeName: host.exeName,
    emulatorId: "pcsx2",
    label: "PCSX2",
    reading: read({ openFiles: [file] }),
  });
  const setup = () => ({
    readings: [reading(disc)],
    observations: [],
    mappings: new Map<string, EmulatorMapping>(),
    runtime: new Map<string, EmulatorRuntimeState>(),
    now: 1_000,
    lookupEnabled: true,
    retryMs: 60_000,
  });

  it("tracks two distinct games, deduplicates identical games and switches within a PID", () => {
    const input = setup();
    const first = reconcileEmulatorReadings({
      ...input,
      readings: [
        reading(disc),
        reading(disc, 11),
        reading("other game.iso", 12),
      ],
    });
    expect(first.runningKeys.size).toBe(2);
    const timed = accumulateObservationRuntime(
      accumulateObservationRuntime(
        first.observations,
        first.runningKeys,
        1_000,
      ),
      first.runningKeys,
      61_000,
    );
    const switched = reconcileEmulatorReadings({
      ...input,
      readings: [reading("third game.iso")],
      observations: timed,
      now: 62_000,
    });
    expect(switched.runningKeys.has("pcsx2:rom:third game.iso")).toBe(true);
    // The vanished second instance receives exactly the normal one-scan grace.
    const settled = reconcileEmulatorReadings({
      ...input,
      readings: [reading("third game.iso")],
      observations: switched.observations,
      now: 67_000,
    });
    expect([...settled.runningKeys]).toEqual(["pcsx2:rom:third game.iso"]);
    expect(
      settled.observations.find(
        (item) => item.key === "pcsx2:rom:final fantasy x (usa).chd",
      ),
    ).toMatchObject({ trackedSeconds: 60, endedAt: expect.any(String) });
  });

  it("stops after idle grace and preserves unresolved runtime", () => {
    const input = setup();
    const first = reconcileEmulatorReadings(input);
    const observations = accumulateObservationRuntime(
      accumulateObservationRuntime(
        first.observations,
        first.runningKeys,
        1_000,
      ),
      first.runningKeys,
      31_000,
      30_000,
    );
    const idle = {
      ...reading(disc),
      reading: read({
        args: [disc],
        openFiles: [],
        windowTitle: "PCSX2 v2.4.0",
      }),
    };
    const grace = reconcileEmulatorReadings({
      ...input,
      readings: [idle],
      observations,
      now: 31_000,
    });
    expect(grace.runningKeys.size).toBe(1);
    const stopped = reconcileEmulatorReadings({
      ...input,
      readings: [idle],
      observations: grace.observations,
      now: 36_000,
    });
    expect(stopped.runningKeys.size).toBe(0);
    expect(stopped.observations[0]).toMatchObject({
      trackedSeconds: 30,
      endedAt: expect.any(String),
    });
  });

  it("respects ignored choices and lookup/privacy settings", () => {
    const input = setup();
    const key = "pcsx2:rom:final fantasy x (usa).chd";
    input.mappings.set(key, {
      emulatorId: "pcsx2",
      contentKey: key,
      decision: "ignored",
    } as EmulatorMapping);
    expect(
      reconcileEmulatorReadings(input).intents.some(
        (intent) => intent.type === "resolve" || intent.type === "match",
      ),
    ).toBe(false);
    for (const result of [
      reconcileEmulatorReadings({ ...setup(), lookupEnabled: false }),
      reconcileEmulatorReadings({
        ...setup(),
        readings: [reading("Philip's game.chd")],
      }),
    ]) {
      expect(result.intents.some((intent) => intent.type === "resolve")).toBe(
        false,
      );
    }
    const serial = reconcileEmulatorReadings({
      ...setup(),
      readings: [
        reading(String.raw`C:\Users\Philip\Final Fantasy X [SLUS-20312].chd`),
      ],
    });
    const request = serial.intents.find((intent) => intent.type === "resolve");
    expect(JSON.stringify(request)).not.toMatch(
      /Philip|Users|openFiles|windowTitle/,
    );
    expect(request).toMatchObject({
      items: [
        {
          emulatorId: "pcsx2",
          contentValue: "slus-20312",
          searchHint: "Final Fantasy X",
        },
      ],
    });
  });
});
