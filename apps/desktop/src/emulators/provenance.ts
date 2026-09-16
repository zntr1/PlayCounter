import type { GameSource, Session } from "@playcounter/shared";
import type { EmulatorMapping } from "./types";

export type EmulatorMatchProvenance = {
  source?: GameSource;
  approval?: "pending";
};

/** Badge evidence for the content-to-game link. mapping.source identifies the
 * metadata/database namespace and must never be changed to set a badge. */
export function emulatorMappingProvenance(
  mapping?: EmulatorMapping,
): EmulatorMatchProvenance {
  if (mapping?.decision !== "game" || mapping.gameId === undefined) return {};
  if (mapping.source === "custom") return { source: "custom" };

  const share =
    mapping.share?.gameId === mapping.gameId ? mapping.share : undefined;
  if (share) {
    if (share.status === "verified" || share.status === "already_curated") {
      return { source: "community" };
    }
    if (share.status === "pending") {
      return { source: "custom", approval: "pending" };
    }
    // A revoked/rejected review takes precedence over an older curated result.
    return { source: "custom" };
  }
  if (mapping.confidence === "curated") return { source: "community" };
  if (mapping.confidence === "user") return { source: "custom" };
  return { source: "igdb" };
}

export function emulatorSessionProvenance(
  session: Pick<Session, "gameId" | "igdbId" | "source" | "emulator">,
  mapping?: EmulatorMapping,
): EmulatorMatchProvenance {
  if (!session.emulator) return { source: session.source };
  if (
    mapping?.contentKey === session.emulator.contentKey &&
    mapping.gameId === session.gameId &&
    (mapping.source ?? "igdb") === (session.source ?? "igdb") &&
    (!mapping.igdbId || !session.igdbId || mapping.igdbId === session.igdbId)
  ) {
    return emulatorMappingProvenance(mapping);
  }
  // A forgotten/replaced link cannot establish provenance for an old session.
  // IGDB metadata alone is not evidence that IGDB identified its game file.
  return session.source === "custom" ? { source: "custom" } : {};
}
