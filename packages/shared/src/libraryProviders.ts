import products from "./battlenet-products.json" with { type: "json" };
import type { LibraryProviderId } from "./index.js";

/** Reviewed product identities. A missing slug always requires user review. */
export const BATTLE_NET_PRODUCTS = products;

export const LIBRARY_PROVIDER_LABELS: Record<LibraryProviderId, string> = {
  steam: "Steam",
  xbox: "Xbox",
  battlenet: "Battle.net",
  epic: "Epic Games",
};

export function isLibraryProvider(value: unknown): value is LibraryProviderId {
  return (
    value === "steam" ||
    value === "xbox" ||
    value === "battlenet" ||
    value === "epic"
  );
}

export function validLibraryExternalId(
  provider: unknown,
  value: unknown,
): value is string {
  if (typeof value !== "string") return false;
  // Epic app names, e.g. "Fortnite" or a 32-character hex id.
  if (provider === "epic")
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
  return provider === "battlenet"
    ? /^[a-z][a-z0-9_]{0,63}$/.test(value)
    : (provider === "steam" || provider === "xbox") &&
        /^[1-9][0-9]{0,9}$/.test(value);
}
