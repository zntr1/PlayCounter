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
  loadXboxAchievementList,
  saveXboxAchievementLists,
  useXboxAchievementLists,
} from "./xboxLists";

/** Just enough IndexedDB: one store, put/get, transactions that complete. */
function fakeIndexedDb() {
  const rows = new Map<string, unknown>();
  const db = {
    createObjectStore: () => undefined,
    transaction: () => {
      const transaction: Record<string, unknown> = {
        objectStore: () => ({
          put: (value: unknown, key: string) => rows.set(key, value),
          get: (key: string) => {
            const request: Record<string, unknown> = {};
            queueMicrotask(() => {
              request.result = rows.get(key);
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
  return {
    rows,
    indexedDB: {
      open: () => {
        const request: Record<string, unknown> = { result: db };
        queueMicrotask(() => (request.onsuccess as () => void)?.());
        return request;
      },
    },
  };
}

function list(externalId: string, name = "Win"): AchievementList {
  return {
    provider: "xbox",
    externalId,
    fetchedAt: 1,
    achievements: [
      { id: "scid:1", name, description: "", hidden: false, unlocked: true },
    ],
  };
}

// One database for the whole file: the module keeps its connection open.
const storage = fakeIndexedDb();

beforeAll(() => {
  vi.stubGlobal("indexedDB", storage.indexedDB);
});

beforeEach(() => {
  storage.rows.clear();
  useXboxAchievementLists.setState({ lists: new Map() });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("Xbox lists on this PC", () => {
  it("an import's lists go to storage, not into memory", async () => {
    await saveXboxAchievementLists([list("1"), list("2")]);
    expect(storage.rows.size).toBe(2);
    expect(useXboxAchievementLists.getState().lists.size).toBe(0);
  });

  it("a list on screen is replaced by the newer one", async () => {
    useXboxAchievementLists.setState({ lists: new Map([["1", null]]) });
    await saveXboxAchievementLists([list("1", "New")]);
    expect(
      useXboxAchievementLists.getState().lists.get("1")?.achievements[0].name,
    ).toBe("New");
  });

  it("a refreshed list stays shown", async () => {
    await saveXboxAchievementLists([list("3")], { show: true });
    expect(useXboxAchievementLists.getState().lists.has("3")).toBe(true);
  });

  it("opening a title reads its list from storage, broken ones count as none", async () => {
    storage.rows.set("1", list("1"));
    storage.rows.set("2", { provider: "xbox", externalId: "2" });
    expect(await loadXboxAchievementList("1")).toEqual(list("1"));
    expect(await loadXboxAchievementList("2")).toBeNull();
    expect(await loadXboxAchievementList("9")).toBeNull();
    expect([...useXboxAchievementLists.getState().lists.keys()]).toEqual([
      "1",
      "2",
      "9",
    ]);
  });
});
