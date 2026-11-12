import { MessageSquareReply } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a } from "./shared";

const t = getT("tour");

export function feedbackRepliesGuide(): TourDefinition {
  return {
    id: "feedback-replies",
    version: 2,
    kind: "guide",
    category: "settings",
    release: "1.1.17",
    icon: MessageSquareReply,
    title: t("Find replies to your feedback"),
    description: t("See where replies to your feedback show up."),
    duration: t("30 sec"),
    steps: [
      {
        id: "send",
        view: "keep",
        anchor: a("send-feedback"),
        title: t("Report a bug or suggest a feature"),
        body: t(
          "Use Help & Feedback to report a bug, ask a question, or suggest a feature. When we answer, the reply shows up right here in PlayCounter. This guide shows a sample reply and does not send anything.",
        ),
      },
      {
        id: "bell",
        view: "keep",
        anchor: a("demo-feedback-notification"),
        positionAnchor: a("demo-feedback-panel"),
        additionalAnchors: [a("notifications-bell")],
        title: t("Replies appear under the bell"),
        body: t(
          "Replies show up in Notifications, together with other PlayCounter updates. This one is a sample; your real notifications and unread count are not changed.",
        ),
      },
      {
        id: "context",
        view: "keep",
        anchor: a("demo-feedback-original"),
        positionAnchor: a("demo-feedback-panel"),
        additionalAnchors: [a("demo-feedback-reply")],
        title: t("Your message stays with the answer"),
        body: t(
          "Your own message is quoted above the reply, so you always know what the answer is about. Replies are delivered to the PlayCounter installation that sent the feedback, so check the bell on this PC after you send something.",
        ),
      },
    ],
  };
}
