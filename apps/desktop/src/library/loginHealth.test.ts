// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("../platform", () => ({ currentPlatform: () => "windows" }));

import { useAppStore } from "../store";
import { signOutKeptLogin, useKeptLogins, type KeptLogin } from "./keptLogins";
import {
  checkLauncherLogin,
  checkLauncherLogins,
  clearLoginHealth,
  getLoginHealth,
  LOGIN_CHECK_INTERVAL_MS,
  recordLoginHealth,
  startLauncherAccountChecks,
  useLoginHealth,
  useLoginWarningCount,
} from "./loginHealth";

const endpoint = "https://api.playcounter.test";
let saved: KeptLogin[];
let stop: (() => void) | undefined;

beforeEach(() => {
  invokeMock.mockReset();
  for (const service of ["xbox", "epic", "battlenet", "gog"] as const)
    clearLoginHealth(service);
  useLoginHealth.setState({ checks: {} });
  useAppStore.setState((state) => ({
    toasts: [],
    settings: { ...state.settings, loginWarningsOff: [] },
  }));
  saved = [{ service: "xbox", name: "Player", savedAt: 1 }];
  useKeptLogins.setState({ logins: saved });
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "logins_list") return saved;
    if (command === "logins_check") return "valid";
    if (command === "logins_sign_out") saved = [];
  });
});

afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("silent launcher account checks", () => {
  it("validates only saved accounts and exposes no credentials or interactive commands", async () => {
    await checkLauncherLogins(endpoint, 0);
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "logins_check"),
    ).toEqual([["logins_check", { service: "xbox", apiEndpoint: endpoint }]]);
    expect(
      invokeMock.mock.calls.every(
        ([command]) => command === "logins_list" || command === "logins_check",
      ),
    ).toBe(true);
    expect(getLoginHealth("xbox")?.status).toBe("valid");
    expect(getLoginHealth("epic")).toBeUndefined();
  });

  it("checks a kept GOG sign-in in the background like the others", async () => {
    saved = [{ service: "gog", name: "zesarex", savedAt: 1 }];
    useKeptLogins.setState({ logins: saved });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "logins_list") return saved;
      if (command === "logins_check") return "needsSignIn";
    });
    await checkLauncherLogins(endpoint, 0);
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "logins_check"),
    ).toEqual([["logins_check", { service: "gog", apiEndpoint: endpoint }]]);
    expect(getLoginHealth("gog")?.status).toBe("needsSignIn");
  });

  it("keeps credentials on temporary failures and retries without a sign-in warning", async () => {
    recordLoginHealth("xbox", "valid");
    const lastSuccess = getLoginHealth("xbox")?.lastSuccessAt;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "logins_check") throw new Error("offline");
      return saved;
    });
    await checkLauncherLogin("xbox", endpoint);
    expect(getLoginHealth("xbox")).toMatchObject({
      status: "unavailable",
      lastSuccessAt: lastSuccess,
    });
    expect(useKeptLogins.getState().logins).toEqual(saved);
    expect(useAppStore.getState().toasts).toHaveLength(0);
  });

  it("shows confirmed expiry once and retains reconnect guidance through temporary failures", async () => {
    invokeMock.mockImplementation(async (command: string) =>
      command === "logins_check" ? "needsSignIn" : saved,
    );
    await checkLauncherLogin("xbox", endpoint);
    await checkLauncherLogin("xbox", endpoint);
    expect(getLoginHealth("xbox")?.status).toBe("needsSignIn");
    expect(useAppStore.getState().toasts).toHaveLength(1);
    invokeMock.mockImplementation(async (command: string) =>
      command === "logins_check" ? "unavailable" : saved,
    );
    await checkLauncherLogin("xbox", endpoint);
    expect(getLoginHealth("xbox")?.status).toBe("needsSignIn");
    expect(useAppStore.getState().toasts).toHaveLength(1);
    expect(useKeptLogins.getState().logins).toEqual(saved);
    recordLoginHealth("xbox", "valid");
    expect(getLoginHealth("xbox")?.status).toBe("valid");
  });

  it("deduplicates overlapping checks and preserves prior health when native code is busy", async () => {
    recordLoginHealth("xbox", "valid");
    let finish!: (status: string) => void;
    invokeMock.mockImplementation((command: string) =>
      command === "logins_check"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(saved),
    );
    const first = checkLauncherLogin("xbox", endpoint);
    const second = checkLauncherLogin("xbox", endpoint);
    expect(first).toBe(second);
    finish("busy");
    await first;
    expect(getLoginHealth("xbox")?.status).toBe("valid");
  });

  it("ignores late expiry after a successful foreground reconnection", async () => {
    let finish!: (status: string) => void;
    invokeMock.mockImplementation((command: string) =>
      command === "logins_check"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(saved),
    );
    const pending = checkLauncherLogin("xbox", endpoint);
    recordLoginHealth("xbox", "valid");
    finish("needsSignIn");
    await pending;
    expect(getLoginHealth("xbox")?.status).toBe("valid");
    expect(useAppStore.getState().toasts).toHaveLength(0);
  });

  it("ignores a late check after explicit sign-out", async () => {
    let finish!: (status: string) => void;
    invokeMock.mockImplementation((command: string) => {
      if (command === "logins_check")
        return new Promise((resolve) => {
          finish = resolve;
        });
      if (command === "logins_sign_out") saved = [];
      return Promise.resolve(saved);
    });
    const pending = checkLauncherLogin("xbox", endpoint);
    await signOutKeptLogin("xbox");
    finish("needsSignIn");
    await pending;
    expect(getLoginHealth("xbox")).toBeUndefined();
    expect(useKeptLogins.getState().logins).toEqual([]);
    expect(useAppStore.getState().toasts).toHaveLength(0);
  });

  it("does not revive old expiry when a reconnected account has a temporary failure", async () => {
    recordLoginHealth("xbox", "needsSignIn");
    let finish!: (status: string) => void;
    invokeMock.mockImplementation((command: string) =>
      command === "logins_check"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(saved),
    );
    const pending = checkLauncherLogin("xbox", endpoint);
    recordLoginHealth("xbox", "valid");
    recordLoginHealth("xbox", "unavailable");
    expect(getLoginHealth("xbox")?.status).toBe("unavailable");
    finish("needsSignIn");
    await pending;
    expect(getLoginHealth("xbox")?.status).toBe("unavailable");
    expect(useAppStore.getState().toasts).toHaveLength(1);
  });

  it("checks at startup and every thirty minutes, and stops on cleanup", async () => {
    vi.useFakeTimers();
    stop = startLauncherAccountChecks(endpoint);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(invokeMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "logins_check"),
    ).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(LOGIN_CHECK_INTERVAL_MS - 1);
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "logins_check"),
    ).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "logins_check"),
    ).toHaveLength(2);
    stop();
    await vi.advanceTimersByTimeAsync(LOGIN_CHECK_INTERVAL_MS * 2);
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "logins_check"),
    ).toHaveLength(2);
  });

  it("retries immediately when connectivity returns, but does not poll confirmed expiry", async () => {
    vi.useFakeTimers();
    invokeMock.mockImplementation(async (command: string) =>
      command === "logins_check" ? "unavailable" : saved,
    );
    stop = startLauncherAccountChecks(endpoint);
    await vi.advanceTimersByTimeAsync(5_000);
    invokeMock.mockImplementation(async (command: string) =>
      command === "logins_check" ? "needsSignIn" : saved,
    );
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(getLoginHealth("xbox")?.status).toBe("needsSignIn");
    const calls = invokeMock.mock.calls.filter(
      ([command]) => command === "logins_check",
    ).length;
    await vi.advanceTimersByTimeAsync(LOGIN_CHECK_INTERVAL_MS * 2);
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "logins_check"),
    ).toHaveLength(calls);
  });
});

describe("sign-in warnings per launcher", () => {
  /** Epic and Battle.net are signed in on this PC, and both sign-ins ran out. */
  function bothSignInsRanOut() {
    saved = [
      { service: "epic", name: "Player", savedAt: 1 },
      { service: "battlenet", name: null, savedAt: 1 },
    ];
    useKeptLogins.setState({ logins: saved });
    invokeMock.mockImplementation(async (command: string) =>
      command === "logins_check" ? "needsSignIn" : saved,
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows no message for a launcher whose warnings are off; the others still warn", async () => {
    bothSignInsRanOut();
    useAppStore.getState().setLoginWarning("battlenet", false);
    await checkLauncherLogins(endpoint, 0);
    expect(useAppStore.getState().toasts.map((toast) => toast.title)).toEqual([
      "Epic Games needs you to sign in again.",
    ]);
  });

  it("keeps checking a launcher whose warnings are off, so the app knows its real state", async () => {
    bothSignInsRanOut();
    useAppStore.getState().setLoginWarning("battlenet", false);
    await checkLauncherLogins(endpoint, 0);
    expect(invokeMock).toHaveBeenCalledWith("logins_check", {
      service: "battlenet",
      apiEndpoint: endpoint,
    });
    expect(getLoginHealth("battlenet")?.status).toBe("needsSignIn");
  });

  it("leaves a launcher with warnings off out of the Launcher accounts badge, and puts it back at once when ticked again", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    const Badge = () => String(useLoginWarningCount());
    await act(() => root.render(createElement(Badge)));
    await act(() => {
      recordLoginHealth("epic", "needsSignIn");
      recordLoginHealth("battlenet", "needsSignIn");
    });
    expect(container.textContent).toBe("2");
    await act(() => useAppStore.getState().setLoginWarning("battlenet", false));
    expect(container.textContent).toBe("1");
    await act(() => useAppStore.getState().setLoginWarning("battlenet", true));
    expect(container.textContent).toBe("2");
    await act(() => root.unmount());
  });

  it("stays off when the launcher is signed in again and its sign-in runs out once more", () => {
    useAppStore.getState().setLoginWarning("battlenet", false);
    recordLoginHealth("battlenet", "needsSignIn");
    recordLoginHealth("battlenet", "valid");
    recordLoginHealth("battlenet", "needsSignIn");
    expect(useAppStore.getState().toasts).toHaveLength(0);
    expect(useAppStore.getState().settings.loginWarningsOff).toEqual([
      "battlenet",
    ]);
  });
});
