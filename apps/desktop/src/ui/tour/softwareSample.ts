import {
  describeToolUsage,
  localDayKey,
  summarizeToolUsage,
  type ToolUsageRecord,
} from "../../toolUsage";
import type { SoftwareRow } from "../views/SoftwareView";

/* The Software page of the "Track software" guide: sample apps with their
   time, so the page is not empty and works while tracking is off. */

export const SAMPLE_SOFTWARE_TOUR_ID = "track-software";

const DAY_MS = 24 * 60 * 60 * 1000;

function sampleRow(
  now: number,
  name: string,
  exeName: string,
  running: boolean,
  local: boolean,
  /** Seconds per day, today first. */
  perDay: number[],
): SoftwareRow {
  const days: ToolUsageRecord["days"] = {};
  perDay.forEach((seconds, back) => {
    if (seconds > 0) days[localDayKey(now - back * DAY_MS)] = seconds;
  });
  const records = [{ days }];
  return {
    toolKey: exeName.toLowerCase(),
    name,
    art: "",
    localArt: false,
    local,
    exeNames: [exeName],
    exePath: null,
    running,
    summary: summarizeToolUsage(records, now),
    details: describeToolUsage(records),
  };
}

// i18n-exempt: sample apps keep their program names.
export function sampleSoftwareRows(now = Date.now()): SoftwareRow[] {
  return [
    sampleRow(
      now,
      "Discord",
      "Discord.exe",
      true,
      false,
      [5_400, 9_000, 7_200, 3_600, 0, 10_800, 6_300],
    ),
    sampleRow(now, "Blender", "blender.exe", true, true, [3_120]),
    sampleRow(
      now,
      "Spotify",
      "Spotify.exe",
      false,
      false,
      [0, 4_500, 6_000, 2_700, 5_100],
    ),
  ];
}
