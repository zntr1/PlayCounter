import { MessageSquareReply } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a } from "./shared";

const t = getT("tour");

// From the second step on, the bell shows a sample reply (NotificationBell.tsx).
// The card then sits left of the open panel.
export function feedbackRepliesGuide(): TourDefinition {
  const panel = a("demo-feedback-panel");
  return {
    id: "feedback-replies",
    version: 3,
    release: "1.1.17",
    kind: "guide",
    category: "settings",
    icon: MessageSquareReply,
    title: t("Find replies to your feedback"),
    description: t("See where replies to your feedback show up."),
    duration: t("30 sec"),
    steps: [
      {
        id: "send",
        view: "keep",
        anchor: a("send-feedback"),
        title: t("Tell us what you think"),
        body: t(
          "<b>Help & Feedback</b> is where you report a bug, wish for a feature or tell us anything else. This guide shows a sample reply: nothing is sent.",
        ),
      },
      {
        id: "bell",
        view: "keep",
        anchor: a("notifications-bell"),
        positionAnchor: panel,
        title: t("Replies appear under the bell"),
        body: t(
          "An answer shows up under the bell, in <b>Notifications</b>, next to other news from PlayCounter. This one is a sample: your own notifications and the unread count stay as they are.",
        ),
      },
      {
        id: "context",
        view: "keep",
        anchor: a("demo-feedback-original"),
        positionAnchor: panel,
        title: t("Your message stays with the answer"),
        body: t(
          "<b>Your feedback</b> is quoted above the reply, so you still know what the answer is about weeks later.",
        ),
      },
      {
        id: "reply",
        view: "keep",
        anchor: a("demo-feedback-reply"),
        positionAnchor: panel,
        title: t("The answer comes to this PC"),
        body: t(
          "A reply goes to the PlayCounter installation that sent the feedback. So after you write to us, look at the bell on this PC, not on another one.",
        ),
      },
    ],
  };
}
