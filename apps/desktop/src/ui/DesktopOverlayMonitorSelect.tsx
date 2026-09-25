import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import {
  listDesktopOverlayMonitors,
  type DesktopOverlayMonitor,
} from "../desktopOverlayBridge";
import { useAppStore } from "../store";
import { Button, Select } from "./primitives";

export function DesktopOverlayMonitorSelect() {
  const selected = useAppStore(
    (state) => state.settings.overlayMonitor ?? "primary",
  );
  const enabled = useAppStore(
    (state) =>
      state.settings.desktopOverlaysEnabled === true ||
      !!state.settings.currentSessionHotkey,
  );
  const setMonitor = useAppStore((state) => state.setOverlayMonitor);
  const [monitors, setMonitors] = useState<DesktopOverlayMonitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listDesktopOverlayMonitors().then(
      (result) => {
        if (cancelled) return;
        setMonitors(result);
        setError(false);
        setLoading(false);
      },
      () => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      },
    );
    const onFocus = () => setRefresh((value) => value + 1);
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const unavailable =
    selected !== "primary" &&
    !monitors.some((monitor) => monitor.id === selected);
  return (
    <div className="grid max-w-[18rem] gap-2">
      <div className="flex items-center gap-2">
        <Select
          aria-label="Popup monitor"
          value={selected}
          disabled={!enabled}
          onChange={(event) => setMonitor(event.target.value)}
          containerClassName="flex-1"
        >
          <option value="primary">Primary monitor (default)</option>
          {monitors.map((monitor) => (
            <option key={monitor.id} value={monitor.id}>
              {monitor.name.replace(/^\\\\\.\\/, "")} · {monitor.width} ×{" "}
              {monitor.height}
              {monitor.primary ? " (primary)" : ""}
            </option>
          ))}
          {unavailable ? (
            <option value={selected}>
              Saved monitor{loading || error ? "" : " (disconnected)"}
            </option>
          ) : null}
        </Select>
        <Button
          icon={RotateCcw}
          loading={loading}
          aria-label="Refresh monitors"
          title="Refresh monitors"
          onClick={() => setRefresh((value) => value + 1)}
        />
      </div>
      {error ? (
        <p role="status" className="text-xs text-text-muted">
          Could not load displays. Try refreshing the list.
        </p>
      ) : unavailable && !loading ? (
        <p role="status" className="text-xs text-text-muted">
          Saved monitor is disconnected. Popups will use the primary monitor
          until it returns.
        </p>
      ) : null}
    </div>
  );
}
