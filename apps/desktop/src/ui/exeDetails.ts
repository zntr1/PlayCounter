import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/* Product name and publisher from an executable's version info, read on this
   PC only. One read per path for the app's lifetime, like ExeIcon; failures
   are cached as null so odd binaries are not retried on every render. */

export type ExeDetails = {
  productName?: string;
  fileDescription?: string;
  companyName?: string;
};

const pending = new Map<string, Promise<ExeDetails | null>>();
const resolved = new Map<string, ExeDetails | null>();

export function loadExeDetails(exePath: string) {
  const key = exePath.toLowerCase();
  let request = pending.get(key);
  if (!request) {
    request = invoke<ExeDetails>("get_exe_details", { exePath })
      .then((details) => details ?? null)
      .catch(() => null)
      .then((details) => {
        resolved.set(key, details);
        return details;
      });
    pending.set(key, request);
  }
  return request;
}

/** Details already read for a path, without waiting. */
export function peekExeDetails(exePath: string | null | undefined) {
  return exePath ? (resolved.get(exePath.toLowerCase()) ?? null) : null;
}

export function useExeDetails(exePath: string | null | undefined) {
  const [details, setDetails] = useState(() => peekExeDetails(exePath));
  useEffect(() => {
    let cancelled = false;
    setDetails(peekExeDetails(exePath));
    if (!exePath) return;
    void loadExeDetails(exePath).then((next) => {
      if (!cancelled) setDetails(next);
    });
    return () => {
      cancelled = true;
    };
  }, [exePath]);
  return details;
}

function clean(value: string | undefined) {
  const text = value?.replace(/[®™©]/g, "").replace(/\s+/g, " ").trim();
  return text || null;
}

/**
 * The name people know the program by, if the file declares one. The
 * description is the most precise ("PostgreSQL Server", "Windows Explorer")
 * where the product is a suite ("PostgreSQL", "Windows Operating System"),
 * unless it only repeats the file name.
 */
export function exeProductName(details: ExeDetails | null, exeName?: string) {
  const description = clean(details?.fileDescription);
  const product = clean(details?.productName);
  const stem = exeName?.replace(/\.exe$/i, "").toLowerCase();
  if (description && description.toLowerCase() !== stem) return description;
  return product ?? description;
}

export function exePublisher(details: ExeDetails | null) {
  return clean(details?.companyName);
}
