import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";

export type UpdateCheckResult =
  | { status: "current" }
  | { status: "available"; version: string; notes?: string };

export type InstallProgress = {
  downloadedBytes: number;
  totalBytes?: number;
};

const UPDATE_CHECK_TIMEOUT_MS = 8_000;

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const update = await withTimeout(
    check(),
    UPDATE_CHECK_TIMEOUT_MS,
    "Update check timed out.",
  );

  if (!update) return { status: "current" };

  return {
    status: "available",
    version: update.version,
    notes: update.body,
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
) {
  let timeout: number | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) window.clearTimeout(timeout);
  }
}

export async function installAvailableUpdate(
  onProgress: (progress: InstallProgress) => void,
) {
  const update = await check();
  if (!update) return false;

  let downloadedBytes = 0;
  let totalBytes: number | undefined;
  await update.downloadAndInstall((event: DownloadEvent) => {
    if (event.event === "Started") {
      downloadedBytes = 0;
      totalBytes = event.data.contentLength;
      onProgress({
        downloadedBytes,
        totalBytes,
      });
      return;
    }

    if (event.event === "Progress") {
      downloadedBytes += event.data.chunkLength;
      onProgress({ downloadedBytes, totalBytes });
    }
  });

  await relaunch();
  return true;
}
