import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  armControllerBridge,
  disposeControllerBridge,
  initializeControllerBridge,
} from "./controllerBridge";
import { useAppStore } from "./store";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);
let controllerHandler: ((event: { payload: unknown }) => void) | undefined;
let unlisten: () => void;

beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "Windows", platform: "Win32" },
  });
  invokeMock.mockReset().mockResolvedValue(undefined);
  unlisten = vi.fn();
  controllerHandler = undefined;
  listenMock.mockReset().mockImplementation(async (_event, handler) => {
    controllerHandler = handler as typeof controllerHandler;
    return unlisten;
  });
  useAppStore.setState((state) => ({
    activeTour: null,
    activeView: "now",
    settings: {
      ...state.settings,
      gameLaunchingEnabled: false,
      controllerNavigationEnabled: false,
    },
  }));
});

afterEach(() => {
  disposeControllerBridge();
  vi.unstubAllGlobals();
});

async function flush() {
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
}

describe("controller bridge", () => {
  it("watches only after both opt-ins are enabled and stops with the master", async () => {
    initializeControllerBridge();
    armControllerBridge();
    expect(invokeMock).not.toHaveBeenCalled();

    useAppStore.getState().setLauncherSetting("gameLaunchingEnabled", true);
    expect(invokeMock).not.toHaveBeenCalled();
    useAppStore
      .getState()
      .setLauncherSetting("controllerNavigationEnabled", true);
    await flush();
    expect(invokeMock).toHaveBeenCalledWith("controller_watch_start");

    useAppStore.getState().setLauncherSetting("gameLaunchingEnabled", false);
    await flush();
    expect(invokeMock).toHaveBeenCalledWith("controller_watch_stop");
  });

  it("reveals My Games, ignores tours, and tears down its listener", async () => {
    const controllerModes: boolean[] = [];
    window.addEventListener("playcounter:controller-mode", (event) => {
      controllerModes.push(
        (event as CustomEvent<{ active: boolean }>).detail.active,
      );
    });
    useAppStore.setState((state) => ({
      settings: {
        ...state.settings,
        gameLaunchingEnabled: true,
        controllerNavigationEnabled: true,
      },
    }));
    initializeControllerBridge();
    armControllerBridge();
    await flush();

    controllerHandler?.({ payload: { action: "reveal", at: 1 } });
    expect(useAppStore.getState().activeView).toBe("games");
    expect(controllerModes).toEqual([true]);

    useAppStore.setState({
      activeView: "now",
      activeTour: {
        tourId: "core",
        stepIndex: 0,
        returnView: "now",
        enteredStepAt: 0,
      },
    });
    controllerHandler?.({ payload: { action: "reveal", at: 2 } });
    expect(useAppStore.getState().activeView).toBe("now");

    disposeControllerBridge();
    await flush();
    expect(controllerModes.at(-1)).toBe(false);
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("controller_watch_stop");
  });
});
