/* Server answers kept between starts: the current covers and the numbers My
   Games sorts by (docs/cover-refresh-plan.md, "Where the app keeps it"). */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Just enough IndexedDB: one database with named stores, put and get,
 *  transactions that complete. Values are copied, as a browser does. */
function fakeIndexedDb() {
  const stores = new Map<string, Map<string, unknown>>();
  let version = 0;
  const storage = {
    stores,
    opened: 0,
    /** The next open fails, like a browser profile that refuses storage. */
    broken: false,
    indexedDB: {
      open: (_name: string, requested: number) => {
        storage.opened += 1;
        const db = {
          objectStoreNames: { contains: (name: string) => stores.has(name) },
          createObjectStore: (name: string) => {
            stores.set(name, new Map());
          },
          close: () => undefined,
          transaction: (name: string) => {
            const rows = stores.get(name);
            if (!rows) throw new DOMException(name, "NotFoundError");
            const transaction: Record<string, unknown> = {
              objectStore: () => ({
                put: (value: unknown, key: string) =>
                  rows.set(key, structuredClone(value)),
                get: (key: string) => {
                  const request: Record<string, unknown> = {};
                  queueMicrotask(() => {
                    request.result = structuredClone(rows.get(key));
                    (request.onsuccess as () => void)?.();
                  });
                  return request;
                },
              }),
            };
            setTimeout(() => (transaction.oncomplete as () => void)?.());
            return transaction;
          },
        };
        const request: Record<string, unknown> = { result: db };
        queueMicrotask(() => {
          if (storage.broken) {
            storage.broken = false;
            request.error = new DOMException("no storage", "UnknownError");
            (request.onerror as () => void)?.();
            return;
          }
          if (requested > version) {
            (request.onupgradeneeded as () => void)?.();
            version = requested;
          }
          (request.onsuccess as () => void)?.();
        });
        return request;
      },
    },
  };
  return storage;
}

/** The module as a freshly started app loads it. */
async function startApp() {
  vi.resetModules();
  return import("./serverCache");
}

describe("server answers kept on this PC", () => {
  let storage: ReturnType<typeof fakeIndexedDb>;

  beforeEach(() => {
    storage = fakeIndexedDb();
    vi.stubGlobal("indexedDB", storage.indexedDB);
  });

  it("what was saved is read back after the app was closed", async () => {
    const saved = { cursor: "1764065430000000,115", covers: { 115: "co_new" } };
    const before = await startApp();
    await before.writeServerCache("currentCovers", saved);

    const after = await startApp();

    await expect(after.readServerCache("currentCovers")).resolves.toEqual(
      saved,
    );
  });

  it("keeps each kind of answer under its own name", async () => {
    const cache = await startApp();
    await cache.writeServerCache("currentCovers", { covers: { 115: "a" } });
    await cache.writeServerCache("gameSortFacts", { facts: { 115: [80] } });

    await expect(cache.readServerCache("currentCovers")).resolves.toEqual({
      covers: { 115: "a" },
    });
    await expect(cache.readServerCache("gameSortFacts")).resolves.toEqual({
      facts: { 115: [80] },
    });
  });

  it("nothing saved yet reads as nothing", async () => {
    const cache = await startApp();

    await expect(
      cache.readServerCache("currentCovers"),
    ).resolves.toBeUndefined();
  });

  it("a newer save replaces the older one", async () => {
    const cache = await startApp();
    await cache.writeServerCache("currentCovers", { cursor: "1,1" });
    await cache.writeServerCache("currentCovers", { cursor: "2,2" });

    await expect(cache.readServerCache("currentCovers")).resolves.toEqual({
      cursor: "2,2",
    });
  });

  it("storage that fails once is tried again the next time", async () => {
    const cache = await startApp();
    storage.broken = true;

    await expect(cache.readServerCache("currentCovers")).rejects.toThrow();
    await cache.writeServerCache("currentCovers", { cursor: "1,1" });

    await expect(cache.readServerCache("currentCovers")).resolves.toEqual({
      cursor: "1,1",
    });
    // One connection serves every later read and write.
    expect(storage.opened).toBe(2);
  });
});
