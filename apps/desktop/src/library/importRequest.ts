import { create } from "zustand";
import type { BuiltinImportProviderId } from "./importProviders";
import { useAppStore } from "../store";

type ImportRequest = {
  provider: BuiltinImportProviderId;
  mode: "account" | "installed";
};

/** A one-shot navigation intent, never persisted with library data. */
export const useLibraryImportRequest = create<{
  request: ImportRequest | null;
}>(() => ({ request: null }));

export function openLauncherImport(
  provider: BuiltinImportProviderId,
  mode: ImportRequest["mode"] = "account",
) {
  useLibraryImportRequest.setState({ request: { provider, mode } });
  useAppStore.getState().setLibraryImportProvider(provider);
  useAppStore.getState().setActiveView("import");
}
