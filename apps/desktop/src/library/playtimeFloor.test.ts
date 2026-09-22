import { describe, expect, it } from "vitest";
import { milestoneMetrics } from "../milestones";
import { effectiveTotalSeconds } from "../playtimeAdjustments";
import {
  providerFloorRecord,
  providerFloors,
  providerFloorsForProvider,
} from "./playtimeFloor";
import type { LibraryImportEntry } from "./types";

const steam: LibraryImportEntry = {
  provider: "steam",
  externalId: "100",
  gameId: 1,
  igdbId: 100,
  source: "igdb",
  name: "Shared game",
  coverUrl: "cover",
  importedAt: "2026-09-22T12:00:00.000Z",
  lastReadAt: "2026-09-22T12:00:00.000Z",
  providerSeconds: 2 * 3600,
  linkedExeNames: [],
  linkedExeSources: [],
};
const xbox: LibraryImportEntry = {
  ...steam,
  provider: "xbox",
  externalId: "200",
  gameId: 2,
  providerSeconds: 3 * 3600,
};

describe("combined launcher playtime", () => {
  it("sums independent launchers for one game and keeps other games separate", () => {
    expect(
      providerFloorRecord(
        providerFloors([
          steam,
          xbox,
          { ...steam, externalId: "300", gameId: 3, igdbId: 300 },
        ]),
      ),
    ).toEqual({ "igdb#100": 5 * 3600, "igdb#300": 2 * 3600 });
  });

  it.each([false, true])(
    "counts each launcher's highest counter only once (reversed: %s)",
    (reversed) => {
      const entries = [
        steam,
        xbox,
        steam,
        { ...steam, externalId: "101", providerSeconds: 4 * 3600 },
        { ...xbox, externalId: "201", providerSeconds: 3600 },
      ];
      if (reversed) entries.reverse();
      expect(providerFloorRecord(providerFloors(entries))).toEqual({
        "igdb#100": 7 * 3600,
      });
    },
  );

  it("adds another launcher's duration when it is available", () => {
    expect(
      providerFloorRecord(
        providerFloors([
          steam,
          xbox,
          { ...steam, provider: "battlenet", providerSeconds: 3600 },
        ]),
      ),
    ).toEqual({ "igdb#100": 6 * 3600 });
  });

  it("ignores unavailable or invalid durations without losing known time", () => {
    const unknown = [null, 0, -3600, Number.NaN, Infinity, -Infinity].map(
      (providerSeconds) => ({ ...xbox, providerSeconds }),
    );
    expect(providerFloors(unknown)).toEqual([]);
    expect(providerFloors([])).toEqual([]);
    expect(
      providerFloorRecord(
        providerFloors([
          steam,
          ...unknown,
          { ...steam, provider: "battlenet", providerSeconds: null },
        ]),
      ),
    ).toEqual({ "igdb#100": 2 * 3600 });
  });

  it("keeps launcher-specific statistics scoped to that launcher", () => {
    const entries = [steam, xbox];
    expect(
      providerFloorRecord(providerFloorsForProvider(entries, "steam")),
    ).toEqual({ "igdb#100": 2 * 3600 });
    expect(
      providerFloorRecord(providerFloorsForProvider(entries, "xbox")),
    ).toEqual({ "igdb#100": 3 * 3600 });
  });

  it.each([
    { trackedHours: 0, adjustmentHours: 0, expectedHours: 5 },
    { trackedHours: 4, adjustmentHours: 0, expectedHours: 5 },
    { trackedHours: 5, adjustmentHours: 0, expectedHours: 5 },
    { trackedHours: 6, adjustmentHours: 0, expectedHours: 6 },
    { trackedHours: 4, adjustmentHours: 2, expectedHours: 6 },
  ])(
    "uses the higher total for display and milestones: $trackedHours tracked + $adjustmentHours adjusted",
    ({ trackedHours, adjustmentHours, expectedHours }) => {
      const floors = providerFloors([steam, xbox]);
      const tracked = trackedHours * 3600;
      const adjusted = adjustmentHours * 3600;
      expect(effectiveTotalSeconds(tracked, adjusted, floors[0].seconds)).toBe(
        expectedHours * 3600,
      );
      const metrics = milestoneMetrics({
        sessions: [],
        archivedSeconds: tracked,
        archivedGameSeconds: { "igdb:1": tracked },
        playtimeAdjustments: { "igdb:1": adjusted },
        providerFloors: floors,
        resolveIgdbId: () => steam.igdbId,
        verifiedContributions: 0,
        now: new Date(steam.importedAt),
      });
      expect(metrics.totalHours).toBe(expectedHours);
      expect(metrics.games.get("igdb#100")?.hours).toBe(expectedHours);
      expect(metrics.monthHours).toBe(0);
    },
  );
});
