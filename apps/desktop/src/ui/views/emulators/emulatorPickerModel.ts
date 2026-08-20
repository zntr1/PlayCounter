import type { ContributionStatus } from "@playcounter/shared";
import type {
  EmulatorContentObservation,
  EmulatorDetectionSource,
  EmulatorMappingShare,
} from "../../../emulators/types";

export function emulatorDetectionSourceLabel(source?: EmulatorDetectionSource) {
  if (source === "window_title") return "window title";
  if (source === "launch_arguments") return "start-up options";
  return null;
}

export function guestPlatformLabel(emulatorId: string) {
  if (emulatorId === "dolphin") return "GameCube / Wii";
  if (emulatorId === "dosbox") return "DOS";
  return "emulator";
}

export type EmulatorPickerPhase = "resolving" | "candidates" | "search";

export function emulatorPickerPhase(
  observation: EmulatorContentObservation,
): EmulatorPickerPhase {
  if (observation.state === "resolving") return "resolving";
  if (observation.candidates?.length) return "candidates";
  return "search";
}

export function emulatorPickerCopy(
  observation: EmulatorContentObservation,
  platformLabel: string,
) {
  if (observation.endedAt) {
    return {
      eyebrow: `New game detected in ${observation.label}`,
      headline: observation.display,
      description:
        "The emulator was closed. Pick the game to keep the tracked playtime.",
      tone: "warning" as const,
    };
  }
  const phase = emulatorPickerPhase(observation);
  return {
    eyebrow: `New game detected in ${observation.label}`,
    headline: observation.display,
    description:
      phase === "resolving"
        ? `Looking for a matching ${platformLabel} game…`
        : phase === "candidates"
          ? "Pick the game that is inside this file."
          : "PlayCounter does not recognize this one. Search for the game once - your choice is remembered on this PC.",
    tone: "accent" as const,
  };
}

export function canShareEmulatorObservation(
  observation: EmulatorContentObservation,
) {
  return observation.shareable && observation.contentKind !== "folder";
}

export function emulatorShareBadgeStatus(
  share?: EmulatorMappingShare,
): ContributionStatus | null {
  if (!share || share.status === "rejected") return null;
  return share.status === "pending" ? "pending" : "verified";
}
