import type { FeedbackRepliesResponse } from "@playcounter/shared";
import { isFeedbackReplyId } from "./notifications";
import { requestJsonResponse } from "./requestJson";
import { useAppStore } from "./store";

export const FEEDBACK_REPLY_POLL_MS = 60_000;
const UNSUPPORTED_RETRY_MS = 60 * 60_000;

function parseReplyPage(
  value: unknown,
  afterId: string,
): FeedbackRepliesResponse {
  if (!value || typeof value !== "object")
    throw new Error("Invalid reply response");
  const page = value as Partial<FeedbackRepliesResponse>;
  if (
    !Array.isArray(page.items) ||
    page.items.length > 50 ||
    typeof page.hasMore !== "boolean" ||
    (page.hasMore && page.items.length === 0)
  ) {
    throw new Error("Invalid reply page");
  }
  let previousId = BigInt(afterId);
  for (const item of page.items) {
    if (
      !item ||
      !isFeedbackReplyId(item.id) ||
      BigInt(item.id) <= previousId ||
      !isFeedbackReplyId(item.feedbackId) ||
      item.feedbackId === "0" ||
      typeof item.message !== "string" ||
      !item.message.trim() ||
      item.message.length > 4000 ||
      (item.feedbackMessage !== undefined &&
        (typeof item.feedbackMessage !== "string" ||
          item.feedbackMessage.length > 4000)) ||
      typeof item.createdAt !== "string" ||
      !Number.isFinite(Date.parse(item.createdAt))
    ) {
      throw new Error("Invalid reply");
    }
    previousId = BigInt(item.id);
  }
  return page as FeedbackRepliesResponse;
}

/** One poller per tracker lifecycle. Pending requests cannot update a new owner. */
export function startFeedbackReplies(): () => void {
  let stopped = false;
  let active: AbortController | undefined;
  let retryAt = 0;
  let repoll = false;
  const requestedContext = new Set<string>();

  async function poll() {
    if (stopped || active || Date.now() < retryAt) return;
    const state = useAppStore.getState();
    if (
      !state.installUuid ||
      state.backendHealth.status === "offline" ||
      state.backendHealth.status === "reconnecting"
    )
      return;
    const installUuid = state.installUuid;
    const endpoint = state.settings.apiEndpoint.replace(/\/+$/, "");
    const marker = state.feedbackReplyCursor;
    const sameOwner =
      marker?.installUuid === installUuid && marker.endpoint === endpoint;
    let afterId = sameOwner ? marker.afterId : "0";
    const missingContext = sameOwner
      ? state.notifications.flatMap((notification) => {
          const id = notification.id.slice("feedback-reply:".length);
          return notification.kind === "feedback-reply" &&
            !notification.feedbackMessage &&
            !requestedContext.has(notification.id) &&
            isFeedbackReplyId(id) &&
            id !== "0"
            ? [{ notificationId: notification.id, id }]
            : [];
        })
      : [];
    for (const { id } of missingContext) {
      if (BigInt(id) <= BigInt(afterId)) afterId = (BigInt(id) - 1n).toString();
    }
    const controller = new AbortController();
    active = controller;
    try {
      // Bound each run; a larger backlog continues from its saved cursor later.
      for (let pageNumber = 0; pageNumber < 5; pageNumber++) {
        const result = await requestJsonResponse<unknown>(
          `${endpoint}/api/feedback/replies`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ installUuid, afterId }),
            signal: controller.signal,
          },
        );
        if (stopped || controller.signal.aborted) return;
        const current = useAppStore.getState();
        if (
          current.installUuid !== installUuid ||
          current.settings.apiEndpoint.replace(/\/+$/, "") !== endpoint
        )
          return;
        if (!result.ok) {
          if (result.status === 404 || result.status === 405)
            retryAt = Date.now() + UNSUPPORTED_RETRY_MS;
          return;
        }
        const page = parseReplyPage(result.data, afterId);
        afterId = page.items.at(-1)?.id ?? afterId;
        // A legacy API may omit the question. Try each retained notification
        // once per run rather than repeatedly replaying its page every minute.
        for (const { notificationId, id } of missingContext) {
          if (!page.hasMore || BigInt(id) <= BigInt(afterId))
            requestedContext.add(notificationId);
        }
        current.receiveFeedbackReplies(
          { endpoint, installUuid, afterId },
          page.items,
        );
        if (!page.hasMore) return;
      }
    } catch {
      // Offline, timeout, and malformed responses keep the last durable cursor.
      // This optional channel must not interrupt tracking or show recurring errors.
    } finally {
      active = undefined;
      if (repoll && !stopped) {
        repoll = false;
        void poll();
      }
    }
  }

  const unsubscribe = useAppStore.subscribe((state, previous) => {
    if (
      state.installUuid !== previous.installUuid ||
      state.settings.apiEndpoint !== previous.settings.apiEndpoint ||
      state.backendHealth.status !== previous.backendHealth.status
    ) {
      if (
        state.installUuid !== previous.installUuid ||
        state.settings.apiEndpoint !== previous.settings.apiEndpoint
      ) {
        requestedContext.clear();
      }
      retryAt = 0;
      if (active) {
        repoll = true;
        active.abort();
      } else void poll();
    }
  });
  const timer = window.setInterval(() => void poll(), FEEDBACK_REPLY_POLL_MS);
  void poll();
  return () => {
    stopped = true;
    active?.abort();
    window.clearInterval(timer);
    unsubscribe();
  };
}
