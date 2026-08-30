import type { LibraryProviderId } from "@playcounter/shared";

/**
 * Providers that the desktop importer can actually import today.
 * Widen this only together with a provider adapter, a generalized import plan,
 * and a provider-aware ImportLibraryView.
 */
export type BuiltinImportProviderId = "steam";

export const DEFAULT_IMPORT_PROVIDER: BuiltinImportProviderId = "steam";

export function isBuiltinImportProvider(
  provider: LibraryProviderId,
): provider is BuiltinImportProviderId {
  return provider === "steam";
}
