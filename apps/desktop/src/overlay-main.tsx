import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  OVERLAY_CLEAR_EVENT,
  OVERLAY_SHOW_EVENT,
  type DesktopOverlayMessage,
} from "./desktopOverlayProtocol";
import "./styles.css";
import { DesktopNotificationOverlay } from "./ui/DesktopNotificationOverlay";

function OverlayRoot() {
  const [message, setMessage] = useState<DesktopOverlayMessage | null>(null);

  useEffect(() => {
    let disposed = false;
    const unlisten: Array<() => void> = [];
    void Promise.all([
      listen<DesktopOverlayMessage>(OVERLAY_SHOW_EVENT, ({ payload }) => {
        if (!disposed) setMessage(payload);
      }),
      listen(OVERLAY_CLEAR_EVENT, () => {
        if (!disposed) setMessage(null);
      }),
    ])
      .then((handlers) => {
        if (disposed) {
          handlers.forEach((handler) => handler());
          return undefined;
        }
        unlisten.push(...handlers);
        return invoke("notification_overlay_ready");
      })
      .catch((error) => console.error("overlay initialization failed", error));
    return () => {
      disposed = true;
      unlisten.forEach((handler) => handler());
    };
  }, []);

  const finish = useCallback((id: string) => {
    setMessage((current) => (current?.id === id ? null : current));
    void invoke("notification_overlay_finished", { id }).catch((error) =>
      console.error("overlay completion failed", error),
    );
  }, []);

  return <DesktopNotificationOverlay message={message} onFinished={finish} />;
}

createRoot(document.getElementById("overlay-root")!).render(<OverlayRoot />);
