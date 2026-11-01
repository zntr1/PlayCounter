import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AchievementList } from "@playcounter/shared";
import { useAppStore, type ActiveSession } from "../store";
import { useKeptLogins } from "../library/keptLogins";
import type { LibraryImportEntry } from "../library/types";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  save: vi.fn(),
  health: "valid",
  revision: 0,
}));
vi.mock("../library/loginHealth", () => ({
  getLoginHealth: () => ({ status: mocks.health }),
  getLoginOperationRevision: () => mocks.revision,
}));
vi.mock("../library/providers/xbox", () => ({
  refreshXboxAchievementList: mocks.refresh,
  XboxSignInRequiredError: class XboxSignInRequiredError extends Error {},
}));
vi.mock("./xboxLists", () => ({ saveXboxAchievementLists: mocks.save }));

import {
  disposePostGameAchievementRefresh,
  schedulePostGameAchievementRefresh,
} from "./backgroundRefresh";
import { XboxSignInRequiredError } from "../library/providers/xbox";

const session: ActiveSession = {
  id: 1,
  gameId: 10,
  igdbId: 100,
  gameName: "Game",
  exeName: "game.exe",
  coverUrl: "cover",
  source: "igdb",
  startedAt: "2026-10-31T10:00:00Z",
  checkpointedAt: "2026-10-31T11:00:00Z",
};
const imported: LibraryImportEntry = {
  provider: "xbox",
  externalId: "1234",
  gameId: 99,
  igdbId: 100,
  source: "igdb",
  name: "Game",
  coverUrl: "cover",
  importedAt: "2026-10-30T10:00:00Z",
  providerSeconds: 0,
  lastReadAt: "2026-10-30T10:00:00Z",
  linkedExeNames: [],
  linkedExeSources: [],
};
const list: AchievementList = {
  provider: "xbox",
  externalId: "1234",
  fetchedAt: 1,
  achievements: [],
};

beforeEach(() => {
  vi.useFakeTimers();
  mocks.refresh.mockReset().mockResolvedValue({ list });
  mocks.save.mockReset().mockResolvedValue(undefined);
  mocks.health = "valid";
  mocks.revision = 0;
  useAppStore.setState({
    activeSessions: [],
    exeCache: new Map(),
    gameMetadata: new Map(),
    libraryImports: new Map([["xbox:1234", imported]]),
  });
  useKeptLogins.setState({
    logins: [{ service: "xbox", name: "Player", savedAt: 1 }],
  });
});

afterEach(() => {
  disposePostGameAchievementRefresh();
  vi.useRealTimers();
});

it("waits for launcher sync, matches canonical identity, and refreshes without interactive login", async () => {
  schedulePostGameAchievementRefresh(session);
  await vi.advanceTimersByTimeAsync(14_999);
  expect(mocks.refresh).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith(
    "1234",
    expect.objectContaining({
      savedLoginOnly: true,
      signal: expect.any(AbortSignal),
    }),
  );
  expect(mocks.save).toHaveBeenCalledWith([list], { show: true });
});

it("coalesces repeated session endings for the same imported title", async () => {
  schedulePostGameAchievementRefresh(session);
  await vi.advanceTimersByTimeAsync(5_000);
  schedulePostGameAchievementRefresh({ ...session, id: 2 });
  await vi.advanceTimersByTimeAsync(14_999);
  expect(mocks.refresh).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.refresh).toHaveBeenCalledOnce();
});

it.each(["missing", "needsSignIn"])(
  "skips automatic reads when authentication is %s",
  async (state) => {
    if (state === "missing") useKeptLogins.setState({ logins: [] });
    else mocks.health = "needsSignIn";
    schedulePostGameAchievementRefresh(session);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.refresh).not.toHaveBeenCalled();
  },
);

it("refreshes a session that ended before the kept sign-in was loaded, as in the first scan after a crash", async () => {
  // Kept sign-ins load a few seconds after the app starts.
  useKeptLogins.setState({ logins: [] });
  schedulePostGameAchievementRefresh(session);
  await vi.advanceTimersByTimeAsync(5_000);
  useKeptLogins.setState({
    logins: [{ service: "xbox", name: "Player", savedAt: 1 }],
  });
  await vi.advanceTimersByTimeAsync(10_000);
  expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith(
    "1234",
    expect.objectContaining({ savedLoginOnly: true }),
  );
});

it("waits until every process for the canonical game has ended", async () => {
  useAppStore.setState({ activeSessions: [{ ...session, id: 2, gameId: 11 }] });
  schedulePostGameAchievementRefresh(session);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("skips the read if the game restarts during the delay", async () => {
  schedulePostGameAchievementRefresh(session);
  useAppStore.setState({ activeSessions: [session] });
  await vi.advanceTimersByTimeAsync(15_000);
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("does not refresh removed imports or a different game with the same name", async () => {
  schedulePostGameAchievementRefresh(session);
  useAppStore.setState({
    libraryImports: new Map([["xbox:1234", { ...imported, igdbId: 200 }]]),
  });
  await vi.advanceTimersByTimeAsync(15_000);
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it.each([new Error("Temporary failure"), new XboxSignInRequiredError()])(
  "preserves cached data when the refresh fails",
  async (error) => {
    mocks.refresh.mockRejectedValue(error);
    schedulePostGameAchievementRefresh(session);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(mocks.save).not.toHaveBeenCalled();
  },
);

it("does not replace cached data when Xbox omits a title's achievements", async () => {
  mocks.refresh.mockResolvedValue({ error: "unavailable" });
  schedulePostGameAchievementRefresh(session);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(mocks.save).not.toHaveBeenCalled();
});

it("aborts an in-flight read on logout and ignores its late response", async () => {
  let complete!: (value: { list: AchievementList }) => void;
  mocks.refresh.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  schedulePostGameAchievementRefresh(session);
  await vi.advanceTimersByTimeAsync(15_000);
  const signal = mocks.refresh.mock.calls[0][1].signal as AbortSignal;
  useKeptLogins.setState({ logins: [] });
  expect(signal.aborted).toBe(true);
  useKeptLogins.setState({
    logins: [{ service: "xbox", name: "Player", savedAt: 2 }],
  });
  complete({ list });
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.save).not.toHaveBeenCalled();
});

it("ignores account switching even if the display name stays the same", async () => {
  let complete!: (value: { list: AchievementList }) => void;
  mocks.refresh.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  schedulePostGameAchievementRefresh(session);
  await vi.advanceTimersByTimeAsync(15_000);
  mocks.revision++;
  complete({ list });
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.save).not.toHaveBeenCalled();
});

it("cancels queued jobs and in-flight work when tracking is reset", async () => {
  schedulePostGameAchievementRefresh(session);
  disposePostGameAchievementRefresh();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(mocks.refresh).not.toHaveBeenCalled();

  mocks.refresh.mockImplementation(() => new Promise(() => {}));
  schedulePostGameAchievementRefresh(session);
  await vi.advanceTimersByTimeAsync(15_000);
  const signal = mocks.refresh.mock.calls[0][1].signal as AbortSignal;
  disposePostGameAchievementRefresh();
  expect(signal.aborted).toBe(true);
});

it("does not invent achievement refresh support for Epic or Battle.net", async () => {
  useAppStore.setState({
    libraryImports: new Map([
      ["epic:game", { ...imported, provider: "epic", externalId: "game" }],
      [
        "battlenet:game",
        { ...imported, provider: "battlenet", externalId: "game" },
      ],
    ]),
  });
  schedulePostGameAchievementRefresh(session);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(mocks.refresh).not.toHaveBeenCalled();
});
