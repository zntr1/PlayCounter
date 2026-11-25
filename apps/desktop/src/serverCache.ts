/* Server answers kept between starts: the current covers (currentCovers.ts)
   and the numbers My Games sorts by (gameSortFacts.ts), so a start does not
   ask the server about the whole library again.

   IndexedDB, not localStorage: the app's own data lives in localStorage, and
   when that is full the oldest sessions are dropped (persistence.ts). Not in
   backups (the server answers again); "Reset local data" clears all webview
   storage, this database included. */
const DATABASE = "playcounter-server-cache";
const VERSION = 1;
const STORE = "answers";

let opening: Promise<IDBDatabase> | undefined;

function database() {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE);
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
    // Tried again by the next read or write.
    opening = undefined;
    throw error;
  });
  return opening;
}

/** What was saved under `name`, or undefined. Rejects when storage fails;
 *  callers then go on without what was saved. */
export async function readServerCache(name: string): Promise<unknown> {
  const db = await database();
  return new Promise<unknown>((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Saves `value` under `name`, in place of what was there. */
export async function writeServerCache(name: string, value: unknown) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(value, name);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
