import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { signInEpicAccount } from "./epicAccount";
import { signInBattleNetAccount } from "./battlenetAccount";
import { signInGogAccount } from "./gogAccount";
import { useKeptLogins } from "./keptLogins";
import {
  clearLoginHealth,
  getLoginHealth,
  recordLoginHealth,
} from "./loginHealth";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  clearLoginHealth("epic");
  clearLoginHealth("battlenet");
  clearLoginHealth("gog");
  useKeptLogins.setState({ logins: [] });
});

const launchers = [
  ["epic", signInEpicAccount, "library_epic_sign_in"],
  ["battlenet", signInBattleNetAccount, "library_battlenet_sign_in"],
  ["gog", signInGogAccount, "library_gog_sign_in"],
] as const;

it.each(launchers)(
  "%s clears an old expiry warning when navigation cancels a saved reconnect",
  async (service, start, nativeCommand) => {
    useKeptLogins.setState({ logins: [{ service, name: null, savedAt: 1 }] });
    recordLoginHealth(service, "needsSignIn");
    let finish!: () => void;
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === nativeCommand)
        return new Promise((_, reject) => {
          finish = () => reject(new Error("CANCELLED"));
        });
      return Promise.resolve(
        command === "logins_list"
          ? [{ service, name: null, savedAt: 2 }]
          : undefined,
      );
    });

    const controller = new AbortController();
    const pending = start(controller.signal);
    const cancelled = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await cancelled;
    expect(getLoginHealth(service)?.status).toBe("needsSignIn");
    finish();

    await vi.waitFor(() =>
      expect(getLoginHealth(service)?.status).toBe("valid"),
    );
    expect(useKeptLogins.getState().logins[0].savedAt).toBe(2);
  },
);

it.each(launchers)(
  "%s ignores a successful old connection after explicit sign-out",
  async (service, start, nativeCommand) => {
    let finish!: () => void;
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === nativeCommand)
        return new Promise((resolve) => {
          finish = () => resolve(undefined);
        });
      return Promise.resolve(command === "logins_list" ? [] : undefined);
    });

    const pending = start();
    clearLoginHealth(service);
    finish();
    await pending;

    expect(getLoginHealth(service)).toBeUndefined();
    expect(useKeptLogins.getState().logins).toEqual([]);
  },
);
