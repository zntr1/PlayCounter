import type { ContributionStatus } from "@playcounter/shared";
import type {
  EmulatorContentObservation,
  EmulatorDetectionSource,
  EmulatorMappingShare,
} from "../../../emulators/types";
import { adapterFor } from "../../../emulators/registry";
import { getT } from "../../../i18n";

const t = getT("emulators");

export function emulatorDetectionSourceLabel(source?: EmulatorDetectionSource) {
  if (source === "window_title") return t("window title");
  if (source === "launch_arguments") return t("start-up options");
  if (source === "open_file_handle") return t("loaded game file");
  return null;
}

export function guestPlatformLabel(emulatorId: string) {
  return adapterFor(emulatorId)?.platformLabel ?? t("emulator");
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
      eyebrow: t("New game detected in {{label}}", {
        label: observation.label,
      }),
      headline: observation.display,
      description: t(
        "The emulator was closed. Pick the game to keep the tracked playtime.",
      ),
      tone: "warning" as const,
    };
  }
  const phase = emulatorPickerPhase(observation);
  return {
    eyebrow: t("New game detected in {{label}}", { label: observation.label }),
    headline: observation.display,
    description:
      phase === "resolving"
        ? t("Looking for a matching {{platformLabel}} game…", { platformLabel })
        : phase === "candidates"
          ? t("Pick the game that is inside this file.")
          : t(
              "PlayCounter does not recognize this one. Search for the game once - your choice is remembered on this PC.",
            ),
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
