import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  disposeQuickNotes,
  initializeQuickNotes,
  openQuickNoteForCurrentSession,
  QUICK_NOTE_SAVE_EVENT,
} from "./quickNote";
import { useAppStore, type ActiveSession } from "./store";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);

function session(
  id: number,
  startedAt: string,
  extra: Partial<ActiveSession> = {},
): ActiveSession {
  return {
    id,
    gameId: -id,
    source: "custom",
    gameName: `Game ${id}`,
    exeName: `game${id}.exe`,
    coverUrl: "",
    startedAt,
    checkpointedAt: startedAt,
    ...extra,
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "Windows", platform: "Win32" },
  });
  invokeMock.mockReset().mockResolvedValue(undefined);
  listenMock.mockReset().mockResolvedValue(vi.fn());
  useAppStore.setState(useAppStore.getInitialState(), true);
});
afterEach(() => disposeQuickNotes());

it("opens the note box for the game started last, with its note", () => {
  useAppStore.setState({
    activeSessions: [
      session(1, "2026-10-14T10:00:00Z"),
      session(2, "2026-10-14T11:00:00Z", { note: "Chapter 3" }),
      // Restored after a crash and not confirmed running yet.
      session(3, "2026-10-14T12:00:00Z", { recoveredFromCheckpoint: true }),
    ],
  });
  expect(openQuickNoteForCurrentSession()).toBe(true);
  expect(invokeMock).toHaveBeenCalledExactlyOnceWith("quick_note_open", {
    payload: expect.objectContaining({
      sessionId: 2,
      gameName: "Game 2",
      note: "Chapter 3",
      startedAt: "2026-10-14T11:00:00Z",
      duration: null,
      labels: expect.objectContaining({ Save: "Save" }),
    }),
  });
});

it("opens nothing when no game is running", () => {
  expect(openQuickNoteForCurrentSession()).toBe(false);
  expect(invokeMock).not.toHaveBeenCalled();
});

it("saves what the note box sends back to that session", async () => {
  useAppStore.setState({
    activeSessions: [session(2, "2026-10-14T11:00:00Z")],
  });
  initializeQuickNotes();
  await Promise.resolve();
  const [event, handler] = listenMock.mock.calls[0];
  expect(event).toBe(QUICK_NOTE_SAVE_EVENT);
  handler({ payload: { sessionId: 2, note: "Found the key" } } as never);
  expect(useAppStore.getState().activeSessions[0].note).toBe("Found the key");
});
