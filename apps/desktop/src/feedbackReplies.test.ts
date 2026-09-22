// @vitest-environment happy-dom
import type { FeedbackReply } from "@playcounter/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBackupContents, createTransferData } from "./backup";
import {
  FEEDBACK_REPLY_POLL_MS,
  startFeedbackReplies,
} from "./feedbackReplies";
import {
  displayNotificationTitle,
  normalizeFeedbackReplyCursor,
} from "./notifications";
import { readPersistedRecord, writePersistedRecord } from "./persistence";
import { useAppStore } from "./store";
import { hydrate } from "./tracker";

const installUuid = "11111111-1111-4111-8111-111111111111";
const secondUuid = "22222222-2222-4222-8222-222222222222";
const reply = (id = "1") => ({
  id,
  feedbackId: "42",
  feedbackMessage: "How can I change the session time shortcut?",
  message: "Open Settings, then choose your shortcut.",
  createdAt: "2026-09-13T10:00:00Z",
});
const page = (items: FeedbackReply[] = [reply()], hasMore = false) =>
  Response.json({ items, hasMore });
let stop: (() => void) | undefined;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    installUuid,
    contributionOwnerUuid: installUuid,
    backendHealth: {
      ...useAppStore.getState().backendHealth,
      status: "online",
    },
  });
  fetchMock = vi.fn<typeof fetch>().mockResolvedValue(page([]));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  stop?.();
  stop = undefined;
  await settle();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("feedback reply inbox", () => {
  it("delivers every page, persists the cursor, and preserves precise IDs", async () => {
    fetchMock
      .mockResolvedValueOnce(page([reply("9007199254740993")], true))
      .mockResolvedValueOnce(page([reply("9007199254740994")]));
    stop = startFeedbackReplies();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      installUuid,
      afterId: "9007199254740993",
    });
    expect(
      useAppStore.getState().notifications.map((entry) => entry.id),
    ).toEqual([
      "feedback-reply:9007199254740994",
      "feedback-reply:9007199254740993",
    ]);
    expect(useAppStore.getState().notifications[0]).toMatchObject({
      kind: "feedback-reply",
      body: reply().message,
      title: "Reply from PlayCounter",
      feedbackMessage: reply().feedbackMessage,
    });
    expect(useAppStore.getState().toasts[0].title).toBe(
      "Reply from PlayCounter",
    );
    expect(readPersistedRecord().feedbackReplyCursor).toMatchObject({
      installUuid,
      afterId: "9007199254740994",
    });
  });

  it("keeps read status and dismissed replies across a real persist/hydrate cycle", async () => {
    fetchMock.mockResolvedValueOnce(page([reply("1"), reply("2")]));
    stop = startFeedbackReplies();
    await settle();
    useAppStore.getState().markAllNotificationsRead();
    useAppStore.getState().dismissNotification("feedback-reply:1");
    await settle();
    stop();
    useAppStore.setState({ feedbackReplyCursor: null, notifications: [] });
    hydrate();
    expect(useAppStore.getState().notifications).toHaveLength(1);
    expect(useAppStore.getState().notifications[0].readAt).toBeTruthy();
    expect(useAppStore.getState().notifications[0].feedbackMessage).toBe(
      reply().feedbackMessage,
    );
    stop = startFeedbackReplies();
    await settle();
    expect(JSON.parse(String(fetchMock.mock.lastCall?.[1]?.body))).toEqual({
      installUuid,
      afterId: "2",
    });
    expect(useAppStore.getState().notifications).toHaveLength(1);
    useAppStore.getState().clearNotifications();
    await vi.advanceTimersByTimeAsync(FEEDBACK_REPLY_POLL_MS);
    expect(useAppStore.getState().notifications).toEqual([]);
    expect(useAppStore.getState().feedbackReplyCursor?.afterId).toBe("2");
  });

  it("keeps dismissed replies dismissed through backup transfer and still delivers new replies", async () => {
    fetchMock.mockResolvedValueOnce(page());
    stop = startFeedbackReplies();
    await settle();
    useAppStore.getState().dismissNotification("feedback-reply:1");
    await settle();
    stop();
    const exported = JSON.parse(createBackupContents());
    localStorage.clear();
    writePersistedRecord(createTransferData(exported.data));
    useAppStore.setState(useAppStore.getInitialState(), true);
    hydrate();
    stop = startFeedbackReplies();
    await settle();

    expect(JSON.parse(String(fetchMock.mock.lastCall?.[1]?.body)).afterId).toBe(
      "1",
    );
    expect(useAppStore.getState().notifications).toEqual([]);
    expect(useAppStore.getState().toasts).toEqual([]);
    fetchMock.mockResolvedValueOnce(page([reply("2")]));
    await vi.advanceTimersByTimeAsync(FEEDBACK_REPLY_POLL_MS);
    expect(
      useAppStore.getState().notifications.map((entry) => entry.id),
    ).toEqual(["feedback-reply:2"]);
    expect(useAppStore.getState().toasts).toHaveLength(1);
  });

  it("resumes a legacy backup baseline after a failed page and restart without hiding newer replies", async () => {
    const suppressThrough = "2026-09-13T10:00:00Z";
    useAppStore.setState({
      feedbackReplyCursor: {
        endpoint: useAppStore
          .getState()
          .settings.apiEndpoint.replace(/\/+$/, ""),
        installUuid,
        afterId: "0",
        suppressThrough,
      },
    });
    fetchMock
      .mockResolvedValueOnce(
        page([{ ...reply("1"), createdAt: "2026-09-12T10:00:00Z" }], true),
      )
      .mockRejectedValueOnce(new Error("offline"));
    stop = startFeedbackReplies();
    await settle();
    expect(useAppStore.getState().notifications).toEqual([]);
    expect(useAppStore.getState().toasts).toEqual([]);
    expect(readPersistedRecord().feedbackReplyCursor).toMatchObject({
      afterId: "1",
      suppressThrough,
    });
    stop();
    useAppStore.setState(useAppStore.getInitialState(), true);
    hydrate();
    fetchMock.mockResolvedValueOnce(
      page([reply("2"), { ...reply("3"), createdAt: "2026-09-13T10:01:00Z" }]),
    );
    stop = startFeedbackReplies();
    await settle();
    expect(JSON.parse(String(fetchMock.mock.lastCall?.[1]?.body)).afterId).toBe(
      "1",
    );
    expect(
      useAppStore.getState().notifications.map((entry) => entry.id),
    ).toEqual(["feedback-reply:3"]);
    expect(useAppStore.getState().toasts).toHaveLength(1);
    expect(readPersistedRecord().feedbackReplyCursor).toMatchObject({
      afterId: "3",
    });
    expect(readPersistedRecord().feedbackReplyCursor).not.toHaveProperty(
      "suppressThrough",
    );
  });

  it("clears a legacy cutoff after an empty successful sync", async () => {
    useAppStore.setState({
      feedbackReplyCursor: {
        endpoint: useAppStore
          .getState()
          .settings.apiEndpoint.replace(/\/+$/, ""),
        installUuid,
        afterId: "0",
        suppressThrough: "2026-09-14T00:00:00Z",
      },
    });
    stop = startFeedbackReplies();
    await settle();
    expect(readPersistedRecord().feedbackReplyCursor).not.toHaveProperty(
      "suppressThrough",
    );
    // A newly delivered reply still arrives even if the clocks differ.
    fetchMock.mockResolvedValueOnce(page());
    await vi.advanceTimersByTimeAsync(FEEDBACK_REPLY_POLL_MS);
    expect(
      useAppStore.getState().notifications.map((entry) => entry.id),
    ).toEqual(["feedback-reply:1"]);
  });

  it.each(["installation", "endpoint"])(
    "does not apply another %s's legacy cutoff",
    async (scope) => {
      useAppStore.setState({
        feedbackReplyCursor: {
          endpoint:
            scope === "endpoint"
              ? "https://another-api.test"
              : useAppStore.getState().settings.apiEndpoint.replace(/\/+$/, ""),
          installUuid: scope === "installation" ? secondUuid : installUuid,
          afterId: "50",
          suppressThrough: "2026-09-14T00:00:00Z",
        },
      });
      fetchMock.mockResolvedValueOnce(page());
      stop = startFeedbackReplies();
      await settle();
      expect(
        JSON.parse(String(fetchMock.mock.lastCall?.[1]?.body)).afterId,
      ).toBe("0");
      expect(
        useAppStore.getState().notifications.map((entry) => entry.id),
      ).toEqual(["feedback-reply:1"]);
      expect(useAppStore.getState().feedbackReplyCursor).not.toHaveProperty(
        "suppressThrough",
      );
    },
  );

  it("adds context to an existing read reply without restoring dismissed replies or advancing the cursor", async () => {
    const readAt = "2026-09-13T11:00:00Z";
    const cursor = {
      endpoint: useAppStore.getState().settings.apiEndpoint.replace(/\/+$/, ""),
      installUuid,
      afterId: "6",
    };
    useAppStore.setState({
      feedbackReplyCursor: cursor,
      notifications: [
        {
          id: "feedback-reply:5",
          kind: "feedback-reply",
          title: "PlayCounter replied to your feedback #42",
          body: reply().message,
          createdAt: reply().createdAt,
          readAt,
        },
      ],
    });
    fetchMock.mockResolvedValueOnce(page([reply("5"), reply("6")]));
    stop = startFeedbackReplies();
    await settle();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).afterId).toBe(
      "4",
    );
    const state = useAppStore.getState();
    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0]).toMatchObject({
      id: "feedback-reply:5",
      readAt,
      feedbackMessage: reply().feedbackMessage,
    });
    expect(displayNotificationTitle(state.notifications[0])).toBe(
      "Reply from PlayCounter",
    );
    expect(state.feedbackReplyCursor).toEqual(cursor);
    expect(state.toasts).toEqual([]);
    await vi.advanceTimersByTimeAsync(FEEDBACK_REPLY_POLL_MS);
    expect(JSON.parse(String(fetchMock.mock.lastCall?.[1]?.body)).afterId).toBe(
      "6",
    );
  });

  it("still accepts an older API and attempts context only once per retained reply", async () => {
    const { feedbackMessage: _, ...legacyReply } = reply();
    fetchMock
      .mockResolvedValueOnce(page([legacyReply]))
      .mockResolvedValueOnce(page([legacyReply]));
    stop = startFeedbackReplies();
    await settle();
    await vi.advanceTimersByTimeAsync(FEEDBACK_REPLY_POLL_MS * 2);
    expect(
      fetchMock.mock.calls.map(
        (call) => JSON.parse(String(call[1]?.body)).afterId,
      ),
    ).toEqual(["0", "0", "1"]);
    expect(useAppStore.getState().notifications).toHaveLength(1);
    expect(useAppStore.getState().toasts).toHaveLength(1);
  });

  it("pauses offline and polls immediately on reconnect", async () => {
    useAppStore.setState({
      backendHealth: {
        ...useAppStore.getState().backendHealth,
        status: "offline",
      },
    });
    stop = startFeedbackReplies();
    await vi.advanceTimersByTimeAsync(FEEDBACK_REPLY_POLL_MS * 2);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(page());
    useAppStore.setState({
      backendHealth: {
        ...useAppStore.getState().backendHealth,
        status: "online",
      },
    });
    await settle();
    expect(useAppStore.getState().notifications).toHaveLength(1);
  });

  it("retries network failures without advancing the cursor", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(page());
    stop = startFeedbackReplies();
    await settle();
    expect(useAppStore.getState().feedbackReplyCursor).toBeNull();
    await vi.advanceTimersByTimeAsync(FEEDBACK_REPLY_POLL_MS);
    expect(useAppStore.getState().notifications).toHaveLength(1);
  });

  it("backs off quietly against an older API", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    stop = startFeedbackReplies();
    await settle();
    await vi.advanceTimersByTimeAsync(FEEDBACK_REPLY_POLL_MS * 10);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().notifications).toEqual([]);
  });

  it("discards an in-flight response when the installation changes", async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    stop = startFeedbackReplies();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    useAppStore.getState().adoptInstallIdentity(secondUuid);
    resolve(page());
    await settle();
    expect(useAppStore.getState().notifications).toEqual([]);
    expect(
      JSON.parse(String(fetchMock.mock.lastCall?.[1]?.body)).installUuid,
    ).toBe(secondUuid);
  });

  it("scopes cursors to API endpoints and discards stale replies on cleanup", async () => {
    fetchMock.mockResolvedValueOnce(page());
    stop = startFeedbackReplies();
    await settle();
    let resolve!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    useAppStore.setState({
      settings: {
        ...useAppStore.getState().settings,
        apiEndpoint: "http://different.test",
      },
    });
    await settle();
    expect(JSON.parse(String(fetchMock.mock.lastCall?.[1]?.body)).afterId).toBe(
      "0",
    );
    stop();
    resolve(page([reply("2")]));
    await settle();
    expect(
      useAppStore.getState().notifications.map((entry) => entry.id),
    ).toEqual(["feedback-reply:1"]);
    const calls = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(FEEDBACK_REPLY_POLL_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });

  it("rejects malformed or out-of-order pages without losing messages", async () => {
    fetchMock.mockResolvedValueOnce(page([reply("10"), reply("2")]));
    stop = startFeedbackReplies();
    await settle();
    expect(useAppStore.getState().feedbackReplyCursor).toBeNull();
    expect(useAppStore.getState().notifications).toEqual([]);
    expect(
      normalizeFeedbackReplyCursor({
        endpoint: "a",
        installUuid,
        afterId: "bad",
      }),
    ).toBeNull();
  });
});
