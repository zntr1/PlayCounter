import { invoke } from "@tauri-apps/api/core";
import type { LocalLibraryProvider } from "../provider";
import type { LibraryScanResult, ProviderStatus } from "../types";
import {
  mergeEpicAccountLibrary,
  readEpicAccountLibrary,
} from "../epicAccount";

export const epicProvider: LocalLibraryProvider = {
  id: "epic",
  label: "Epic Games",
  accountMode: "none",
  detect: async () =>
    (await invoke<ProviderStatus[]>("library_detect_providers")).find(
      (provider) => provider.provider === "epic",
    ) ?? { provider: "epic", available: false, checkedPaths: [] },
  listAccounts: async () => [],
  scan: async (_accountId, options) => {
    options?.signal?.throwIfAborted();
    const account = options?.epicAccount
      ? await readEpicAccountLibrary(options.signal)
      : undefined;
    options?.signal?.throwIfAborted();
    const result = await invoke<LibraryScanResult>("library_scan", {
      provider: "epic",
      accountId: 0,
    });
    options?.signal?.throwIfAborted();
    return account ? mergeEpicAccountLibrary(account, result) : result;
  },
  launch: (externalId, mode = "play") =>
    invoke<void>("library_launch_app", {
      provider: "epic",
      externalId,
      mode,
    }),
};
