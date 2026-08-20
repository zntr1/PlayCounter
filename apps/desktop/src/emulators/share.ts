import { isShareableToken } from "./signals";
import type { EmulatorMapping } from "./types";

export type EmulatorShareContext = {
  privateTokens: readonly string[];
  privacyReady: boolean;
  installUuid: string | null;
  offline: boolean;
  serverUnavailable: boolean;
};

export function isShareableEmulatorMapping(
  mapping: EmulatorMapping,
  context: Pick<EmulatorShareContext, "privateTokens" | "privacyReady">,
) {
  if (mapping.decision !== "game") return false;
  if (mapping.gameId === undefined || mapping.gameId <= 0) return false;
  if (mapping.source === "custom" || mapping.shareable === false) return false;
  if (mapping.shareable === undefined && !context.privacyReady) return false;
  return isShareableToken({
    value: mapping.contentValue,
    kind: mapping.contentKind,
    trust: mapping.trust,
    privateTokens: context.privateTokens,
  });
}

export type EmulatorShareControl =
  | { visible: false }
  | {
      visible: true;
      action: "share";
      label: string;
      disabled: boolean;
      reason?: string;
    };

export function emulatorShareControl(
  mapping: EmulatorMapping,
  context: EmulatorShareContext,
): EmulatorShareControl {
  if (!isShareableEmulatorMapping(mapping, context)) return { visible: false };
  const share =
    mapping.share?.gameId === mapping.gameId ? mapping.share : undefined;
  if (share) return { visible: false };

  const base = {
    visible: true as const,
    action: "share" as const,
    label: "Share match",
  };
  if (context.offline) {
    return {
      ...base,
      disabled: true,
      reason: "Sharing needs an internet connection.",
    };
  }
  if (!context.installUuid) {
    return {
      ...base,
      disabled: true,
      reason: "PlayCounter is still starting up.",
    };
  }
  if (context.serverUnavailable) {
    return {
      ...base,
      disabled: true,
      reason: "This server does not accept emulator matches yet.",
    };
  }
  return { ...base, disabled: false };
}
