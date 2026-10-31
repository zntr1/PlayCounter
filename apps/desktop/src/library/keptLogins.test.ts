import { afterEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import {
  refreshKeptLogins,
  signOutKeptLogin,
  useKeptLogins,
} from "./keptLogins";

afterEach(() => {
  invokeMock.mockReset();
  useKeptLogins.setState({ logins: [] });
});

describe("kept sign-ins in the web UI", () => {
  it("knows the service, the name and when, nothing else", async () => {
    invokeMock.mockResolvedValue([
      {
        service: "xbox",
        name: "Master Chief",
        savedAt: 5,
        secret: "M.C5_refresh",
      },
      { service: "battlenet", name: null, savedAt: 6 },
      { service: "steam", name: "Not a kept sign-in", savedAt: 7 },
      "garbage",
    ]);

    const logins = await refreshKeptLogins();

    expect(invokeMock).toHaveBeenCalledWith("logins_list");
    expect(logins).toEqual([
      { service: "xbox", name: "Master Chief", savedAt: 5 },
      { service: "battlenet", name: null, savedAt: 6 },
    ]);
    expect(JSON.stringify(useKeptLogins.getState())).not.toContain("refresh");
  });

  it("has none when this system keeps no sign-ins", async () => {
    invokeMock.mockRejectedValue(new Error("unknown command"));

    await expect(refreshKeptLogins()).resolves.toEqual([]);
  });

  it("keeps the last known accounts when the secure store cannot be read", async () => {
    const saved = [{ service: "epic" as const, name: "Player One", savedAt: 1 }];
    useKeptLogins.setState({ logins: saved });
    invokeMock.mockRejectedValue(new Error("secure store temporarily locked"));

    await expect(refreshKeptLogins()).resolves.toEqual(saved);
    expect(useKeptLogins.getState().logins).toEqual(saved);
  });

  it("Sign out asks the Rust part and reads the list again, even when it fails", async () => {
    useKeptLogins.setState({
      logins: [{ service: "epic", name: "Player One", savedAt: 1 }],
    });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "logins_sign_out") throw new Error("disk busy");
      return [];
    });

    await expect(signOutKeptLogin("epic")).rejects.toThrow("disk busy");
    expect(invokeMock).toHaveBeenCalledWith("logins_sign_out", {
      service: "epic",
    });
    expect(useKeptLogins.getState().logins).toEqual([]);
  });
});
