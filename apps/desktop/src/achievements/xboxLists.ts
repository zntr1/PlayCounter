import { create } from "zustand";
import type { AchievementList } from "@playcounter/shared";
import { parseAchievementList } from "./model";

/* Xbox lists stay on this PC: refreshing them needs a Microsoft sign-in, so
   they are kept between starts. IndexedDB, because 500 titles of lists would
   crowd localStorage. Not in backups (an Xbox import fetches them again);
   "Reset local data" clears all webview storage, this database included. */
const DATABASE = "playcounter-achievements";
const STORE = "xbox";

export const useXboxAchievementLists = create<{
  /** Title id → its list; null when nothing is saved for the title. */
  lists: ReadonlyMap<string, AchievementList | null>;
}>(() => ({ lists: new Map() }));

let opening: Promise<IDBDatabase> | undefined;

function database() {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
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

function remember(titleId: string, list: AchievementList | null) {
  useXboxAchievementLists.setState((state) => ({
    lists: new Map(state.lists).set(titleId, list),
  }));
}

/** The saved list of one Xbox title, or null. */
export async function loadXboxAchievementList(titleId: string) {
  const known = useXboxAchievementLists.getState().lists.get(titleId);
  if (known !== undefined) return known;
  const db = await database();
  const value = await new Promise<unknown>((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(titleId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const list = parseAchievementList(value);
  const parsed = list?.provider === "xbox" && list.externalId === titleId;
  // A save that finished meanwhile wins over what was on disk.
  const current = useXboxAchievementLists.getState().lists.get(titleId);
  if (current !== undefined) return current;
  remember(titleId, parsed ? list : null);
  return parsed ? list : null;
}

/** A newer list replaces the older one of its title. Titles that failed
 *  this time are simply not in `lists`, so their older list stays.
 *  Memory only keeps lists something shows (an import can bring 500 of
 *  them); `show` keeps these too, even if storage fails. */
export async function saveXboxAchievementLists(
  lists: readonly AchievementList[],
  { show = false }: { show?: boolean } = {},
) {
  const valid = lists.filter((list) => list.provider === "xbox");
  if (!valid.length) return;
  useXboxAchievementLists.setState((state) => {
    const next = new Map(state.lists);
    let changed = false;
    for (const list of valid) {
      if (!show && !next.has(list.externalId)) continue;
      next.set(list.externalId, list);
      changed = true;
    }
    return changed ? { lists: next } : state;
  });
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    for (const list of valid) store.put(list, list.externalId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
