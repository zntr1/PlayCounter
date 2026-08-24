import { describe, expect, it, vi } from "vitest";
import {
  INSTALL_PRESENCE_RETRY_COOLDOWN_MS,
  INSTALL_PRESENCE_SUCCESS_COOLDOWN_MS,
  INSTALL_PRESENCE_UNSUPPORTED_COOLDOWN_MS,
  reportInstallPresence,
  sanitizeInstallPresenceMarker,
  shouldSendInstallPresence,
  type InstallPresenceMarker,
} from "./installPresence";

const now = Date.parse("2026-08-24T12:00:00.000Z");
const installUuid = "550e8400-e29b-41d4-a716-446655440000";
const endpoint = "https://api.playcounter.test";

function marker(
  kind: InstallPresenceMarker["kind"] = "success",
  ageMs = 1_000,
): InstallPresenceMarker {
  return {
    endpoint,
    installUuid,
    sentAt: new Date(now - ageMs).toISOString(),
    kind,
  };
}

describe("install presence scheduling", () => {
  it("requires an identity and sends immediately without a marker", () => {
    expect(
      shouldSendInstallPresence({
        installUuid: null,
        apiEndpoint: endpoint,
        marker: null,
        now,
      }),
    ).toBe(false);
    expect(
      shouldSendInstallPresence({
        installUuid,
        apiEndpoint: endpoint,
        marker: null,
        now,
      }),
    ).toBe(true);
  });

  it("binds the cooldown to the normalized endpoint and identity", () => {
    const current = marker();
    expect(
      shouldSendInstallPresence({
        installUuid,
        apiEndpoint: `${endpoint}/`,
        marker: current,
        now,
      }),
    ).toBe(false);
    expect(
      shouldSendInstallPresence({
        installUuid,
        apiEndpoint: "https://other.playcounter.test",
        marker: current,
        now,
      }),
    ).toBe(true);
    expect(
      shouldSendInstallPresence({
        installUuid: "c56a4180-65aa-42ec-a945-5fd21dec0538",
        apiEndpoint: endpoint,
        marker: current,
        now,
      }),
    ).toBe(true);
  });

  it.each([
    ["success", INSTALL_PRESENCE_SUCCESS_COOLDOWN_MS],
    ["retry", INSTALL_PRESENCE_RETRY_COOLDOWN_MS],
    ["unsupported", INSTALL_PRESENCE_UNSUPPORTED_COOLDOWN_MS],
  ] as const)("applies the %s cooldown", (kind, cooldown) => {
    expect(
      shouldSendInstallPresence({
        installUuid,
        apiEndpoint: endpoint,
        marker: marker(kind, cooldown - 1),
        now,
      }),
    ).toBe(false);
    expect(
      shouldSendInstallPresence({
        installUuid,
        apiEndpoint: endpoint,
        marker: marker(kind, cooldown),
        now,
      }),
    ).toBe(true);
  });

  it("fails open for invalid or future timestamps", () => {
    expect(
      shouldSendInstallPresence({
        installUuid,
        apiEndpoint: endpoint,
        marker: { ...marker(), sentAt: "invalid" },
        now,
      }),
    ).toBe(true);
    expect(
      shouldSendInstallPresence({
        installUuid,
        apiEndpoint: endpoint,
        marker: { ...marker(), sentAt: new Date(now + 1_000).toISOString() },
        now,
      }),
    ).toBe(true);
  });
});

describe("install presence reporting", () => {
  it("returns a normalized success marker and typed payload", async () => {
    const request = vi.fn(async () => ({ ok: true, status: 204 }));

    await expect(
      reportInstallPresence({
        installUuid,
        apiEndpoint: `${endpoint}///`,
        marker: null,
        now,
        request,
      }),
    ).resolves.toEqual({
      endpoint,
      installUuid,
      sentAt: new Date(now).toISOString(),
      kind: "success",
    });
    expect(request).toHaveBeenCalledWith(endpoint, { installUuid });
  });

  it.each([
    [404, "unsupported"],
    [405, "unsupported"],
    [500, "retry"],
  ] as const)("maps status %i to %s", async (status, kind) => {
    const result = await reportInstallPresence({
      installUuid,
      apiEndpoint: endpoint,
      marker: null,
      now,
      request: async () => ({ ok: false, status }),
    });
    expect(result?.kind).toBe(kind);
  });

  it("turns a network failure into a retry marker", async () => {
    const result = await reportInstallPresence({
      installUuid,
      apiEndpoint: endpoint,
      marker: null,
      now,
      request: async () => {
        throw new Error("offline");
      },
    });
    expect(result?.kind).toBe("retry");
  });

  it("does no I/O and preserves the marker reference while cooled down", async () => {
    const current = marker();
    const request = vi.fn();
    const result = await reportInstallPresence({
      installUuid,
      apiEndpoint: endpoint,
      marker: current,
      now,
      request,
    });
    expect(result).toBe(current);
    expect(request).not.toHaveBeenCalled();
  });
});

describe("install presence persistence", () => {
  it("sanitizes and normalizes a valid marker", () => {
    expect(
      sanitizeInstallPresenceMarker({ ...marker(), endpoint: `${endpoint}/` }),
    ).toEqual(marker());
  });

  it.each([
    null,
    "marker",
    {},
    { ...marker(), kind: "invalid" },
    { ...marker(), sentAt: "invalid" },
    { ...marker(), installUuid: 42 },
  ])("rejects invalid persisted marker %#", (value) => {
    expect(sanitizeInstallPresenceMarker(value)).toBeNull();
  });
});
