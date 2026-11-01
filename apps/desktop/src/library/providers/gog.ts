import { invoke } from "@tauri-apps/api/core";
import type { LocalLibraryProvider } from "../provider";
import type { LibraryScanResult, ProviderStatus } from "../types";
import { mergeGogAccountLibrary, readGogAccountLibrary } from "../gogAccount";

export const gogProvider: LocalLibraryProvider = {
  id: "gog",
  label: "GOG",
  accountMode: "none",
  detect: async () =>
    (await invoke<ProviderStatus[]>("library_detect_providers")).find(
      (provider) => provider.provider === "gog",
    ) ?? { provider: "gog", available: false, checkedPaths: [] },
  listAccounts: async () => [],
  scan: async (_accountId, options) => {
    options?.signal?.throwIfAborted();
    if (options?.gogAccount) options.onStage?.("account");
    const account = options?.gogAccount
      ? await readGogAccountLibrary(options.signal)
      : undefined;
    options?.signal?.throwIfAborted();
    options?.onStage?.("installs");
    const result = await invoke<LibraryScanResult>("library_scan", {
      provider: "gog",
      accountId: 0,
    });
    options?.signal?.throwIfAborted();
    return account ? mergeGogAccountLibrary(account, result) : result;
  },
  launch: (externalId, mode = "play") =>
    invoke<void>("library_launch_app", {
      provider: "gog",
      externalId,
      mode,
    }),
};
