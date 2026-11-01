import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { create } from "zustand";

/* Launcher sign-ins PlayCounter keeps on this PC. The Rust part holds them,
   encrypted with Windows' own data protection. This side only ever learns
   which service, the name to show and when: never a token. */
export type KeptLoginService = "xbox" | "epic" | "battlenet" | "gog";

export type KeptLogin = {
  service: KeptLoginService;
  /** Xbox gamertag, Epic display name or GOG user name. Battle.net has none. */
  name: string | null;
  savedAt: number;
};

const SERVICES: readonly string[] = ["xbox", "epic", "battlenet", "gog"];

export const useKeptLogins = create<{ logins: readonly KeptLogin[] }>(() => ({
  logins: [],
}));

function parseKeptLogins(value: unknown): KeptLogin[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): KeptLogin[] => {
    if (!item || typeof item !== "object") return [];
    const { service, name, savedAt } = item as Record<string, unknown>;
    if (typeof service !== "string" || !SERVICES.includes(service)) return [];
    return [
      {
        service: service as KeptLoginService,
        name: typeof name === "string" && name.trim() ? name.trim() : null,
        savedAt: typeof savedAt === "number" ? savedAt : 0,
      },
    ];
  });
}

export async function refreshKeptLogins() {
  let logins: KeptLogin[] = [];
  try {
    logins = parseKeptLogins(await invoke<unknown>("logins_list"));
  } catch {
    // A temporary native failure is not a sign-out. Keep the last known list.
    return useKeptLogins.getState().logins.slice();
  }
  useKeptLogins.setState({ logins });
  return logins;
}

/** Deletes the kept sign-in. Epic's session also ends at Epic. */
export async function signOutKeptLogin(service: KeptLoginService) {
  const { beginLoginAccountChange, clearLoginHealth } =
    await import("./loginHealth");
  beginLoginAccountChange(service);
  try {
    await invoke("logins_sign_out", { service });
    clearLoginHealth(service);
  } finally {
    await refreshKeptLogins();
  }
}

let loaded = false;

/** The kept sign-in for one service, or null. Loads the list once. */
export function useKeptLogin(service: KeptLoginService | null) {
  useEffect(() => {
    if (loaded) return;
    loaded = true;
    void refreshKeptLogins();
  }, []);
  return useKeptLogins(
    (state) => state.logins.find((login) => login.service === service) ?? null,
  );
}

export function useAllKeptLogins() {
  useEffect(() => {
    if (loaded) return;
    loaded = true;
    void refreshKeptLogins();
  }, []);
  return useKeptLogins((state) => state.logins);
}
