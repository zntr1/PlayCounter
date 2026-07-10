import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";

// One extraction per exe path for the app's lifetime; failures are cached as
// null so missing/odd binaries are not retried on every render.
const iconCache = new Map<string, Promise<string | null>>();

function loadExeIcon(exePath: string) {
  const key = exePath.toLowerCase();
  let pending = iconCache.get(key);
  if (!pending) {
    pending = invoke<string>("get_exe_icon", { exePath })
      .then((png) => `data:image/png;base64,${png}`)
      .catch(() => null);
    iconCache.set(key, pending);
  }
  return pending;
}

export function ExeIcon({
  exePath,
  className,
  fallback = null,
}: {
  exePath: string | null;
  className?: string;
  fallback?: ReactNode;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    if (!exePath) return;
    void loadExeIcon(exePath).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [exePath]);

  if (!src) return <>{fallback}</>;
  return <img src={src} alt="" className={className} />;
}
