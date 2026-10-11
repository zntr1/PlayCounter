import {
  discoveredReviewNotificationText,
  openDiscoveredLabel,
} from "./discoveredReminder";
import { milestoneTitle, parseMilestoneId } from "./milestones";
import {
  openEmulatorLabel,
  suggestionText,
  type AppNotification,
} from "./notifications";
import { getT } from "./i18n";

const t = getT("shell");

export type NotificationText = {
  title: string;
  body?: string;
  actionLabel?: string;
};

/** What a notification says, made again from its facts so it follows the
 *  app's language. Notifications saved without facts keep their saved text. */
export function notificationText(
  notification: AppNotification,
): NotificationText {
  const saved: NotificationText = {
    title: notification.title,
    body: notification.body,
    actionLabel: notification.action?.label,
  };
  // Saved data: every fact is checked before use.
  const params: Record<string, unknown> =
    notification.params && typeof notification.params === "object"
      ? notification.params
      : {};
  const text = (key: string) =>
    typeof params[key] === "string" ? (params[key] as string) : undefined;

  switch (notification.kind) {
    case "feedback-reply":
      return { ...saved, title: t("Reply from PlayCounter") };
    case "suggestion-verified":
    case "suggestion-rejected": {
      const game = text("game");
      const file = text("file");
      if (game === undefined || file === undefined) return saved;
      const emulator = text("emulator");
      return {
        ...suggestionText(notification.kind, {
          game,
          file,
          emulator,
          note: text("note"),
          software: params.software === true,
        }),
        actionLabel:
          emulator !== undefined && notification.action
            ? openEmulatorLabel(emulator)
            : saved.actionLabel,
      };
    }
    case "discovered-review": {
      const count = params.count;
      if (typeof count !== "number" || !Number.isFinite(count)) return saved;
      return {
        ...discoveredReviewNotificationText(count),
        actionLabel: notification.action ? openDiscoveredLabel() : undefined,
      };
    }
    default: {
      const parsed = parseMilestoneId(notification.id);
      const game = text("game");
      if (!parsed || (parsed.category === "game" && !game)) return saved;
      return { ...saved, title: milestoneTitle(parsed, game) };
    }
  }
}
