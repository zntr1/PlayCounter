import "./disableBrowserContextMenu";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { LiveTimerPayload } from "./liveTimer";
import "./styles.css";
import { applyTheme } from "./theme";
import { LiveTimerPill } from "./ui/LiveTimerPill";

const UPDATE_EVENT = "playcounter:live-timer-update";
/** Rust says whether the mouse rests on the pill (it then takes clicks). */
const HOVER_EVENT = "playcounter:live-timer-hover";

function LiveTimerRoot() {
  const [payload, setPayload] = useState<LiveTimerPayload | null>(null);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listen<boolean>(HOVER_EVENT, ({ payload }) => setHovered(payload === true))
      .then((handler) => {
        if (disposed) handler();
        else unlisten = handler;
      })
      .catch((error) => console.error("live timer hover failed", error));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const apply = (next: LiveTimerPayload | null | undefined) => {
      if (disposed || !next) return;
      // Always dark: it sits over a game, not over PlayCounter.
      applyTheme("dark", next.accentColor);
      setPayload(next);
    };
    // Listen first, then ask: an update sent in between is not lost.
    listen<LiveTimerPayload>(UPDATE_EVENT, ({ payload }) => apply(payload))
      .then((handler) => {
        if (disposed) {
          handler();
          return undefined;
        }
        unlisten = handler;
        return invoke<LiveTimerPayload | null>("live_timer_ready");
      })
      .then(apply)
      .catch((error) => console.error("live timer failed to load", error));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return payload ? (
    <LiveTimerPill
      payload={payload}
      hovered={hovered}
      onTogglePause={() =>
        void invoke("live_timer_toggle_pause").catch((error) =>
          console.error("live timer pause failed", error),
        )
      }
    />
  ) : null;
}

createRoot(document.getElementById("live-timer-root")!).render(
  <LiveTimerRoot />,
);
