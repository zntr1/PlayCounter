import { invoke } from "@tauri-apps/api/core";
import type { LocalLibraryProvider } from "../provider";
import type { LibraryScanResult, ProviderStatus } from "../types";

export const battleNetProvider: LocalLibraryProvider = {
  id: "battlenet",
  label: "Battle.net",
  accountMode: "none",
  detect: async () =>
    (await invoke<ProviderStatus[]>("library_detect_providers")).find(
      (provider) => provider.provider === "battlenet",
    ) ?? { provider: "battlenet", available: false, checkedPaths: [] },
  listAccounts: async () => [],
  scan: async (_accountId, options) => {
    options?.signal?.throwIfAborted();
    const result = await invoke<LibraryScanResult>("library_scan", {
      provider: "battlenet",
      accountId: 0,
    });
    options?.signal?.throwIfAborted();
    return result;
  },
  launch: (externalId, mode = "store") =>
    invoke<void>("library_launch_app", {
      provider: "battlenet",
      externalId,
      mode,
    }),
};
