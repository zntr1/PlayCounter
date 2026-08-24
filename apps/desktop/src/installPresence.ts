import type { InstallPresencePayload } from "@playcounter/shared";

export const INSTALL_PRESENCE_SUCCESS_COOLDOWN_MS = 20 * 60 * 60 * 1000;
export const INSTALL_PRESENCE_RETRY_COOLDOWN_MS = 5 * 60 * 1000;
export const INSTALL_PRESENCE_UNSUPPORTED_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type InstallPresenceMarkerKind = "success" | "retry" | "unsupported";

export type InstallPresenceMarker = {
  endpoint: string;
  installUuid: string;
  sentAt: string;
  kind: InstallPresenceMarkerKind;
};

export type InstallPresenceRequestResult = { ok: boolean; status: number };
export type InstallPresenceRequestFn = (
  endpoint: string,
  payload: InstallPresencePayload,
) => Promise<InstallPresenceRequestResult>;

export function normalizeInstallPresenceEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, "");
}

export function shouldSendInstallPresence(input: {
  installUuid: string | null;
  apiEndpoint: string;
  marker: InstallPresenceMarker | null;
  now: number;
}): boolean {
  if (!input.installUuid) return false;

  const endpoint = normalizeInstallPresenceEndpoint(input.apiEndpoint);
  const marker = input.marker;
  if (
    !marker ||
    marker.installUuid !== input.installUuid ||
    marker.endpoint !== endpoint
  ) {
    return true;
  }

  const sentAtMs = Date.parse(marker.sentAt);
  if (!Number.isFinite(sentAtMs)) return true;
  const elapsed = input.now - sentAtMs;
  if (elapsed < 0) return true;

  const cooldown =
    marker.kind === "success"
      ? INSTALL_PRESENCE_SUCCESS_COOLDOWN_MS
      : marker.kind === "unsupported"
        ? INSTALL_PRESENCE_UNSUPPORTED_COOLDOWN_MS
        : INSTALL_PRESENCE_RETRY_COOLDOWN_MS;
  return elapsed >= cooldown;
}

export async function reportInstallPresence(input: {
  installUuid: string | null;
  apiEndpoint: string;
  marker: InstallPresenceMarker | null;
  now?: number;
  request: InstallPresenceRequestFn;
}): Promise<InstallPresenceMarker | null> {
  const now = input.now ?? Date.now();
  if (
    !shouldSendInstallPresence({
      installUuid: input.installUuid,
      apiEndpoint: input.apiEndpoint,
      marker: input.marker,
      now,
    })
  ) {
    return input.marker;
  }

  const installUuid = input.installUuid as string;
  const endpoint = normalizeInstallPresenceEndpoint(input.apiEndpoint);
  const sentAt = new Date(now).toISOString();
  try {
    const result = await input.request(endpoint, { installUuid });
    if (result.ok) return { endpoint, installUuid, sentAt, kind: "success" };
    if (result.status === 404 || result.status === 405) {
      return { endpoint, installUuid, sentAt, kind: "unsupported" };
    }
    return { endpoint, installUuid, sentAt, kind: "retry" };
  } catch {
    return { endpoint, installUuid, sentAt, kind: "retry" };
  }
}

export function sanitizeInstallPresenceMarker(
  value: unknown,
): InstallPresenceMarker | null {
  if (!value || typeof value !== "object") return null;
  const marker = value as Partial<InstallPresenceMarker>;
  if (
    typeof marker.endpoint !== "string" ||
    typeof marker.installUuid !== "string" ||
    typeof marker.sentAt !== "string" ||
    !Number.isFinite(Date.parse(marker.sentAt)) ||
    (marker.kind !== "success" &&
      marker.kind !== "retry" &&
      marker.kind !== "unsupported")
  ) {
    return null;
  }

  return {
    endpoint: normalizeInstallPresenceEndpoint(marker.endpoint),
    installUuid: marker.installUuid,
    sentAt: marker.sentAt,
    kind: marker.kind,
  };
}
