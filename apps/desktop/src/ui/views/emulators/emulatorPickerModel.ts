import type { EmulatorContentObservation } from "../../../emulators/types";

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
      eyebrow: `${observation.label} content detected`,
      headline: observation.display,
      description:
        "The emulator stopped. Choose the game to keep the detected playtime.",
      tone: "warning" as const,
    };
  }
  const phase = emulatorPickerPhase(observation);
  return {
    eyebrow: `${observation.label} content detected`,
    headline: observation.display,
    description:
      phase === "resolving"
        ? `Looking for a matching ${platformLabel} game…`
        : phase === "candidates"
          ? "Pick the game that is inside this file."
          : "PlayCounter could not identify it. Search once — the choice is remembered on this PC.",
    tone: "accent" as const,
  };
}
