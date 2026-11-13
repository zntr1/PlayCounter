import { create } from "zustand";
import type { Screenshot } from "./screenshots";

/* The two sample pictures of the Screenshots guide (public/tour). They live
   here and nowhere else: they never join the list of the player's real
   pictures, and no call to Rust is made for them. */

const PREFIX = "/tour/sample-shot-";

/** A picture of the guide's sample, not a file on this PC. */
export const isSampleShot = (path: string) => path.startsWith(PREFIX);

export const useSampleScreenshots = create<{ shots: Screenshot[] }>(() => ({
  shots: [],
}));

/** Puts the sample pictures back as they were, inside the sample session. */
export function resetSampleScreenshots(
  gameName: string,
  sessionStartMs: number,
) {
  const shot = (
    index: number,
    minutes: number,
    caption: string | null,
  ): Screenshot => ({
    path: `${PREFIX}${index}.svg`,
    folder: gameName,
    name: `${gameName} ${index}.svg`,
    bytes: 1,
    modifiedMs: sessionStartMs + minutes * 60_000,
    previewPath: `${PREFIX}${index}.svg`,
    caption,
    takenAtMs: sessionStartMs + minutes * 60_000,
  });
  useSampleScreenshots.setState({
    shots: [
      shot(1, 20, null),
      // i18n-exempt: a sample caption, as a player would type it
      shot(2, 55, "Finally down on the third try"),
    ],
  });
}
