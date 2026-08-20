import {
  BadgeCheck,
  CalendarCheck,
  CircleSlash,
  Flame,
  Gamepad2,
  ListChecks,
  Joystick,
  ShieldCheck,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { achievementArt, type AchievementIconName } from "../achievementArt";
import type { AppNotification } from "../notifications";

type AchievementDisplay = Pick<
  AppNotification,
  "id" | "kind" | "title" | "coverUrl"
>;

const ICONS: Record<AchievementIconName, LucideIcon> = {
  trophy: Trophy,
  calendar: CalendarCheck,
  gamepad: Gamepad2,
  flame: Flame,
  "badge-check": BadgeCheck,
  joystick: Joystick,
  "shield-check": ShieldCheck,
  "circle-slash": CircleSlash,
  "list-checks": ListChecks,
};

export function AchievementBadge({
  notification,
}: {
  notification: AchievementDisplay;
}) {
  const art = achievementArt(notification);
  const Icon = ICONS[art.icon];

  return (
    <div
      role="img"
      aria-label={art.label}
      className={`grid h-12 w-9 shrink-0 place-items-center rounded ${art.frameClassName}`}
    >
      <Icon aria-hidden="true" size={18} strokeWidth={2} />
    </div>
  );
}

export function AchievementMedal({
  notification,
  locked = false,
  size = "md",
}: {
  notification: AchievementDisplay;
  locked?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const art = achievementArt(notification);
  const Icon = ICONS[art.icon];
  const dimensions = {
    sm: { frame: "h-7 w-7", icon: 13 },
    md: { frame: "h-11 w-11", icon: 19 },
    lg: { frame: "h-14 w-14", icon: 24 },
  }[size];

  return (
    <div
      role="img"
      aria-label={`${art.label}${locked ? " (locked)" : ""}`}
      className={`grid shrink-0 place-items-center rounded-full ${dimensions.frame} ${art.frameClassName} ${locked ? "achievement-badge-locked" : ""}`}
    >
      <Icon aria-hidden="true" size={dimensions.icon} strokeWidth={2.25} />
    </div>
  );
}

export function NotificationArt({
  notification,
}: {
  notification: AchievementDisplay;
}) {
  const [failedCoverUrl, setFailedCoverUrl] = useState<string | null>(null);
  const coverUrl = notification.coverUrl;

  if (!coverUrl || failedCoverUrl === coverUrl) {
    return <AchievementBadge notification={notification} />;
  }

  const isMilestone = notification.kind.startsWith("milestone-");
  const art = achievementArt(notification);
  const TierIcon = ICONS[art.icon];

  return (
    <div className="relative h-12 w-9 shrink-0">
      <img
        src={coverUrl}
        alt=""
        className="h-full w-full rounded object-cover"
        onError={() => setFailedCoverUrl(coverUrl)}
      />
      {isMilestone ? (
        <span
          aria-hidden="true"
          className={`absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full ${art.frameClassName}`}
        >
          <TierIcon size={10} strokeWidth={2.5} />
        </span>
      ) : null}
    </div>
  );
}
