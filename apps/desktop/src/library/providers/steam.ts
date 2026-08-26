import { invoke } from "@tauri-apps/api/core";
import type { LocalLibraryProvider } from "../provider";
import type {
  LibraryScanResult,
  LocalLibraryAccount,
  ProviderStatus,
} from "../types";

export const steamProvider: LocalLibraryProvider = {
  id: "steam",
  label: "Steam",
  detect: async () => {
    const providers = await invoke<ProviderStatus[]>(
      "library_detect_providers",
    );
    return (
      providers.find((provider) => provider.provider === "steam") ?? {
        provider: "steam",
        available: false,
        checkedPaths: [],
      }
    );
  },
  listAccounts: () =>
    invoke<LocalLibraryAccount[]>("library_list_accounts", {
      provider: "steam",
    }),
  scan: (accountId) =>
    invoke<LibraryScanResult>("library_scan", {
      provider: "steam",
      accountId,
    }),
  launch: (externalId, mode = "play") =>
    invoke<void>("library_launch_app", {
      provider: "steam",
      externalId,
      mode,
    }),
};
