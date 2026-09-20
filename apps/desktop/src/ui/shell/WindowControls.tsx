import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";

/* The window has no native frame (tauri.conf.json: decorations false), so
   these three buttons stand in for it. They only exist inside Tauri: in the
   browser dev server and in tests there is no window to control, and the row
   renders nothing rather than three dead buttons. Close goes through the
   normal close request, which the Rust side turns into hide-to-tray. */

type TauriWindow = {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
  onResized(handler: () => void): Promise<() => void>;
};

function insideTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function currentWindow(): Promise<TauriWindow> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

export function WindowControls() {
  const [available] = useState(insideTauri);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!available) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void currentWindow()
      .then(async (win) => {
        const sync = () =>
          win
            .isMaximized()
            .then((value) => {
              if (!disposed) setMaximized(value);
            })
            .catch(() => undefined);
        await sync();
        unlisten = await win.onResized(() => void sync());
        if (disposed) unlisten();
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [available]);

  if (!available) return null;

  const run = (action: (win: TauriWindow) => Promise<void>) => () =>
    void currentWindow()
      .then(action)
      .catch((error) => console.warn("window control failed", error));

  return (
    <div className="window-controls flex h-full shrink-0 items-stretch">
      <button
        type="button"
        aria-label="Minimize window"
        title="Minimize"
        onClick={run((win) => win.minimize())}
        className="window-control"
      >
        <Minus size={18} strokeWidth={2} />
      </button>
      <button
        type="button"
        aria-label={maximized ? "Restore window" : "Maximize window"}
        title={maximized ? "Restore" : "Maximize"}
        onClick={run((win) => win.toggleMaximize())}
        className="window-control"
      >
        {maximized ? (
          <Copy size={15} strokeWidth={2} className="-scale-x-100" />
        ) : (
          <Square size={14} strokeWidth={2} />
        )}
      </button>
      <button
        type="button"
        aria-label="Close window"
        title="Close"
        onClick={run((win) => win.close())}
        className="window-control window-control-close"
      >
        <X size={19} strokeWidth={2} />
      </button>
    </div>
  );
}
