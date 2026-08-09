import { Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store";
import { NotificationsPanel } from "./NotificationsPanel";
import { IconButton } from "./primitives";

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const unread = useAppStore(
    (state) =>
      state.notifications.filter((notification) => !notification.readAt).length,
  );
  const markAllRead = useAppStore((state) => state.markAllNotificationsRead);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !containerRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function toggle() {
    setOpen((current) => {
      const next = !current;
      if (next) markAllRead();
      return next;
    });
  }

  return (
    <div ref={containerRef} className="relative">
      <IconButton
        aria-label="Open notifications"
        title="Notifications"
        icon={Bell}
        onClick={toggle}
      />
      {unread > 0 ? (
        <span className="pointer-events-none absolute -right-1.5 -top-1.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-danger-solid px-1 text-[9px] font-bold text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
      {open ? <NotificationsPanel onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
