import { CheckCheck, Trash2, X } from "lucide-react";
import { useAppStore } from "../store";
import { NotificationArt } from "./AchievementBadge";
import { Panel } from "./components";
import { Button, IconButton, useEscapeKey } from "./primitives";

export function NotificationsPanel({ onClose }: { onClose: () => void }) {
  const notifications = useAppStore((state) => state.notifications);
  const counts = useAppStore((state) => state.contributionCounts);
  const dismiss = useAppStore((state) => state.dismissNotification);
  const clear = useAppStore((state) => state.clearNotifications);
  useEscapeKey(onClose);

  return (
    <Panel className="absolute right-0 top-10 z-40 flex max-h-[min(620px,calc(100vh-90px))] w-[390px] flex-col overflow-hidden rounded-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="font-semibold text-text">Notifications</h2>
          <p className="text-xs text-text-muted">Updates from PlayCounter</p>
        </div>
        <IconButton
          aria-label="Close notifications"
          icon={X}
          onClick={onClose}
        />
      </div>

      <div className="border-b border-border bg-surface-hover/40 px-4 py-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-faint">
          Your contributions
        </div>
        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            ["Suggested", counts.suggested],
            ["Verified", counts.verified],
            ["Pending", counts.pending],
            ["Rejected", counts.rejected],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-md border border-border bg-surface px-1 py-2"
            >
              <div className="font-mono text-base font-semibold text-text">
                {value}
              </div>
              <div className="text-[10px] text-text-faint">{label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {notifications.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-text-muted">
            <CheckCheck className="mx-auto mb-3 text-text-faint" size={24} />
            You’re all caught up.
          </div>
        ) : (
          notifications.map((notification) => (
            <article
              key={notification.id}
              className="flex gap-3 border-b border-border/70 px-4 py-3 last:border-b-0"
            >
              <NotificationArt notification={notification} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-text">
                  {notification.title}
                </div>
                {notification.body ? (
                  <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-text-muted">
                    {notification.body}
                  </p>
                ) : null}
                <time className="mt-1 block text-[11px] text-text-faint">
                  {new Date(notification.createdAt).toLocaleString()}
                </time>
              </div>
              <IconButton
                aria-label="Dismiss notification"
                title="Dismiss"
                icon={X}
                onClick={() => dismiss(notification.id)}
                className="border-transparent"
              />
            </article>
          ))
        )}
      </div>

      {notifications.length > 0 ? (
        <div className="border-t border-border p-3 text-right">
          <Button variant="ghost" icon={Trash2} onClick={clear}>
            Clear all
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}
