import { create } from "zustand";
import type { AchievementList } from "@playcounter/shared";
import { parseAchievementList } from "./model";

/* Xbox, Epic Games, GOG and PlayStation lists stay on this PC: refreshing
   them needs a launcher sign-in, so they are kept between starts. IndexedDB,
   because 500 titles of lists would crowd localStorage. Not in backups (an import or a refresh
   fetches them again); "Reset local data" clears all webview storage, this
   database included. */
const DATABASE = "playcounter-achievements";
/** Version 1 held Xbox only; version 2 adds Epic Games, version 3 GOG,
 *  version 4 PlayStation (by concept id). */
const VERSION = 4;
const STORES = ["xbox", "epic", "gog", "playstation"] as const;

export type SavedAchievementProvider = (typeof STORES)[number];

export const useAchievementLists = create<{
  /** "provider:externalId" → its list; null when nothing is saved for it. */
  lists: ReadonlyMap<string, AchievementList | null>;
}>(() => ({ lists: new Map() }));

export function achievementListKey(
  provider: SavedAchievementProvider,
  externalId: string,
) {
  return `${provider}:${externalId}`;
}

function saved(
  list: AchievementList,
): list is AchievementList & { provider: SavedAchievementProvider } {
  return (STORES as readonly string[]).includes(list.provider);
}

let opening: Promise<IDBDatabase> | undefined;

function database() {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    // An older database keeps its stores and their lists; only new ones are
    // added.
    request.onupgradeneeded = () => {
      for (const store of STORES)
        if (!request.result.objectStoreNames.contains(store))
          request.result.createObjectStore(store);
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        opening = undefined;
      };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  }).catch((error: unknown) => {
    opening = undefined;
    throw error;
  });
  return opening;
}

function remember(key: string, list: AchievementList | null) {
  useAchievementLists.setState((state) => ({
    lists: new Map(state.lists).set(key, list),
  }));
}

/** The saved list of one Xbox title, Epic game, GOG game or PlayStation
 *  game, or null. */
export async function loadAchievementList(
  provider: SavedAchievementProvider,
  externalId: string,
) {
  const key = achievementListKey(provider, externalId);
  const known = useAchievementLists.getState().lists.get(key);
  if (known !== undefined) return known;
  const db = await database();
  const value = await new Promise<unknown>((resolve, reject) => {
    const request = db
      .transaction(provider)
      .objectStore(provider)
      .get(externalId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const list = parseAchievementList(value);
  const parsed = list?.provider === provider && list.externalId === externalId;
  // A save that finished meanwhile wins over what was on disk.
  const current = useAchievementLists.getState().lists.get(key);
  if (current !== undefined) return current;
  remember(key, parsed ? list : null);
  return parsed ? list : null;
}

/** A newer list replaces the older one of its game. Games that failed this
 *  time are simply not in `lists`, so their older list stays.
 *  Memory only keeps lists something shows (an import can bring 500 of
 *  them); `show` keeps these too, even if storage fails. */
export async function saveAchievementLists(
  lists: readonly AchievementList[],
  { show = false }: { show?: boolean } = {},
) {
  const valid = lists.filter(saved);
  if (!valid.length) return;
  useAchievementLists.setState((state) => {
    const next = new Map(state.lists);
    let changed = false;
    for (const list of valid) {
      const key = achievementListKey(list.provider, list.externalId);
      if (!show && !next.has(key)) continue;
      next.set(key, list);
      changed = true;
    }
    return changed ? { lists: next } : state;
  });
  const db = await database();
  const stores = [...new Set(valid.map((list) => list.provider))];
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(stores, "readwrite");
    for (const list of valid)
      transaction.objectStore(list.provider).put(list, list.externalId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
