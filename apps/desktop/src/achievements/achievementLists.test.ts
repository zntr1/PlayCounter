import type { AchievementList } from "@playcounter/shared";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  achievementListKey,
  loadAchievementList,
  saveAchievementLists,
  useAchievementLists,
} from "./achievementLists";

/** Just enough IndexedDB: versions, named stores, put/get, transactions that
 *  complete. Like browsers, creating a store that exists fails the upgrade. */
function fakeIndexedDb() {
  const stores = new Map<string, Map<string, unknown>>();
  let version = 0;
  const db = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string) => {
      if (stores.has(name))
        throw new DOMException(`${name} exists`, "ConstraintError");
      stores.set(name, new Map());
    },
    close: () => undefined,
    transaction: (names: string | string[]) => {
      const transaction: Record<string, unknown> = {
        objectStore: (name: string) => {
          const rows = stores.get(name);
          if (!rows || ![names].flat().includes(name))
            throw new DOMException(name, "NotFoundError");
          return {
            put: (value: unknown, key: string) => rows.set(key, value),
            get: (key: string) => {
              const request: Record<string, unknown> = {};
              queueMicrotask(() => {
                request.result = rows.get(key);
                (request.onsuccess as () => void)?.();
              });
              return request;
            },
          };
        },
      };
      setTimeout(() => (transaction.oncomplete as () => void)?.());
      return transaction;
    },
  };
  return {
    stores,
    /** The database as an older PlayCounter left it. */
    seed(atVersion: number, rows: Record<string, Record<string, unknown>>) {
      version = atVersion;
      stores.clear();
      for (const [name, entries] of Object.entries(rows))
        stores.set(name, new Map(Object.entries(entries)));
    },
    indexedDB: {
      open: (_name: string, requested: number) => {
        const request: Record<string, unknown> = { result: db };
        queueMicrotask(() => {
          if (requested > version) {
            try {
              (request.onupgradeneeded as () => void)?.();
            } catch (error) {
              request.error = error;
              (request.onerror as () => void)?.();
              return;
            }
            version = requested;
          }
          (request.onsuccess as () => void)?.();
        });
        return request;
      },
    },
  };
}

function xboxList(externalId: string, name = "Win"): AchievementList {
  return {
    provider: "xbox",
    externalId,
    fetchedAt: 1,
    achievements: [
      { id: "scid:1", name, description: "", hidden: false, unlocked: true },
    ],
  };
}

function epicList(externalId: string): AchievementList {
  return {
    provider: "epic",
    externalId,
    fetchedAt: 2,
    achievements: [
      {
        id: "1",
        name: "Stocked",
        description: "Collect 150 Items",
        hidden: false,
        unlocked: false,
        xp: 50,
      },
    ],
  };
}

// One database for the whole file: the module keeps its connection open.
const storage = fakeIndexedDb();
const rows = (store: string) => storage.stores.get(store) ?? new Map();

beforeAll(() => {
  vi.stubGlobal("indexedDB", storage.indexedDB);
});

beforeEach(() => {
  for (const store of storage.stores.values()) store.clear();
  useAchievementLists.setState({ lists: new Map() });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("lists on this PC", () => {
  it("an import's lists go to storage, not into memory", async () => {
    await saveAchievementLists([xboxList("1"), xboxList("2")]);
    expect(rows("xbox").size).toBe(2);
    expect(useAchievementLists.getState().lists.size).toBe(0);
  });

  it("a list on screen is replaced by the newer one", async () => {
    const key = achievementListKey("xbox", "1");
    useAchievementLists.setState({ lists: new Map([[key, null]]) });
    await saveAchievementLists([xboxList("1", "New")]);
    expect(
      useAchievementLists.getState().lists.get(key)?.achievements[0].name,
    ).toBe("New");
  });

  it("a refreshed list stays shown", async () => {
    await saveAchievementLists([epicList("Sugar")], { show: true });
    expect(
      useAchievementLists
        .getState()
        .lists.get(achievementListKey("epic", "Sugar")),
    ).toEqual(epicList("Sugar"));
  });

  it("opening a game reads its list from storage, broken ones count as none", async () => {
    rows("xbox").set("1", xboxList("1"));
    rows("xbox").set("2", { provider: "xbox", externalId: "2" });
    expect(await loadAchievementList("xbox", "1")).toEqual(xboxList("1"));
    expect(await loadAchievementList("xbox", "2")).toBeNull();
    expect(await loadAchievementList("xbox", "9")).toBeNull();
    expect([...useAchievementLists.getState().lists.keys()]).toEqual([
      "xbox:1",
      "xbox:2",
      "xbox:9",
    ]);
  });

  it("keeps each store's lists in its own place", async () => {
    await saveAchievementLists([epicList("Sugar"), xboxList("1234")]);
    expect([...rows("epic").keys()]).toEqual(["Sugar"]);
    expect([...rows("xbox").keys()]).toEqual(["1234"]);
    // An Epic list under an Xbox id is no Xbox list.
    rows("xbox").set("Sugar", epicList("Sugar"));
    expect(await loadAchievementList("xbox", "Sugar")).toBeNull();
    expect(await loadAchievementList("epic", "Sugar")).toEqual(
      epicList("Sugar"),
    );
  });
});

function gogList(externalId: string): AchievementList {
  return {
    provider: "gog",
    externalId,
    fetchedAt: 3,
    achievements: [
      {
        id: "WIN_10",
        name: "Ten Wins",
        description: "",
        hidden: false,
        unlocked: true,
      },
    ],
  };
}

describe("the update that adds GOG", () => {
  it("keeps the Xbox and Epic Games lists version 2 saved", async () => {
    storage.seed(2, {
      xbox: { "1234": xboxList("1234") },
      epic: { Sugar: epicList("Sugar") },
    });
    vi.resetModules();
    const lists = await import("./achievementLists");
    expect(await lists.loadAchievementList("xbox", "1234")).toEqual(
      xboxList("1234"),
    );
    expect(await lists.loadAchievementList("epic", "Sugar")).toEqual(
      epicList("Sugar"),
    );
    await lists.saveAchievementLists([gogList("1213504814")]);
    expect(rows("gog").get("1213504814")).toEqual(gogList("1213504814"));
    expect(rows("xbox").get("1234")).toEqual(xboxList("1234"));
    expect(rows("epic").get("Sugar")).toEqual(epicList("Sugar"));
  });
});

describe("the update that adds Epic Games", () => {
  it("keeps the Xbox lists an older version saved", async () => {
    storage.seed(1, { xbox: { "1234": xboxList("1234") } });
    // A fresh start of the app on the old database.
    vi.resetModules();
    const lists = await import("./achievementLists");
    expect(await lists.loadAchievementList("xbox", "1234")).toEqual(
      xboxList("1234"),
    );
    await lists.saveAchievementLists([epicList("Sugar")]);
    expect(rows("epic").get("Sugar")).toEqual(epicList("Sugar"));
    expect(rows("xbox").get("1234")).toEqual(xboxList("1234"));
  });
});
