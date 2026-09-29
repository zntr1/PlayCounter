// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { GameSource } from "@playcounter/shared";
import { hideToTrayWhenGameStarts } from "./hideToTrayOnLaunch";
import {
  createDefaultSettings,
  useAppStore,
  type ActiveSession,
} from "./store";

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));

const close = vi.fn();
const game = [{ gameId: 7, source: "igdb" as const }];

function startSession(gameId: number, source: GameSource = "igdb") {
  useAppStore.setState((state) => ({
    activeSessions: [
      ...state.activeSessions,
      { id: gameId, gameId, source } as ActiveSession,
    ],
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  close.mockReset().mockResolvedValue(undefined);
  vi.mocked(getCurrentWindow).mockReturnValue({
    close,
  } as unknown as ReturnType<typeof getCurrentWindow>);
  useAppStore.setState({
    activeSessions: [],
    settings: createDefaultSettings(),
  });
});

afterEach(() => {
  // Let any watch still armed by a test run out.
  vi.advanceTimersByTime(120_000);
  vi.useRealTimers();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe("hide to tray when a launched game starts", () => {
  it("hides the window once the launched game is running", async () => {
    hideToTrayWhenGameStarts(game);
    expect(close).not.toHaveBeenCalled();
    startSession(7);
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  });

  it("is on by default", () => {
    expect(createDefaultSettings().hideToTrayOnGameStart).toBe(true);
  });

  it("ignores other games and the same id from another source", async () => {
    hideToTrayWhenGameStarts(game);
    startSession(8);
    startSession(7, "community");
    await vi.advanceTimersByTimeAsync(0);
    expect(close).not.toHaveBeenCalled();
  });

  it("stays open when the setting is off", async () => {
    useAppStore.setState((state) => ({
      settings: { ...state.settings, hideToTrayOnGameStart: false },
    }));
    hideToTrayWhenGameStarts(game);
    startSession(7);
    await vi.advanceTimersByTimeAsync(0);
    expect(close).not.toHaveBeenCalled();
  });

  it("gives up when the game has not started after two minutes", async () => {
    hideToTrayWhenGameStarts(game);
    await vi.advanceTimersByTimeAsync(120_000);
    startSession(7);
    await vi.advanceTimersByTimeAsync(0);
    expect(close).not.toHaveBeenCalled();
  });

  it("hides only once", async () => {
    hideToTrayWhenGameStarts(game);
    startSession(7);
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    startSession(9);
    useAppStore.setState({ activeSessions: [] });
    startSession(7);
    await vi.advanceTimersByTimeAsync(0);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("watches only the latest launch", async () => {
    hideToTrayWhenGameStarts(game);
    hideToTrayWhenGameStarts([{ gameId: 9, source: "igdb" }]);
    startSession(7);
    await vi.advanceTimersByTimeAsync(0);
    expect(close).not.toHaveBeenCalled();
    startSession(9);
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  });
});
