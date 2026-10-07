import { beforeEach, expect, it, vi } from "vitest";
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (value: string) => value,
  invoke: invokeMock,
}));
vi.mock("./platform", () => ({ currentPlatform: () => "macos" }));
import { useAppStore, type ExeCacheEntry } from "./store";
import { forgetNonGameDiscoveries } from "./tracker";

function entry(
  exeName: string,
  fields: Partial<ExeCacheEntry> = {},
): ExeCacheEntry {
  return {
    exeName,
    state: "unmatched",
    lastCheckedAt: "2026-10-07T12:00:00.000Z",
    ...fields,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
});

it("drops unmatched macOS discoveries the scanner now skips", async () => {
  const cached = [
    entry("trustd", { exePath: "/usr/libexec/trustd" }),
    entry("widgetextension"),
    entry("stardew valley", {
      exePath: "/Applications/Stardew Valley.app/Contents/MacOS/Stardew Valley",
    }),
    entry("suggested", {
      exePath: "/usr/libexec/suggested",
      communitySuggestionId: 7,
    }),
    entry("celeste", {
      state: "matched",
      gameId: 1,
      exePath: "/System/Celeste",
    }),
  ];
  useAppStore.setState({
    exeCache: new Map(cached.map((item) => [item.exeName, item])),
  });
  invokeMock.mockImplementation(
    async (_command: string, args: { paths: (string | null)[] }) =>
      args.paths.map((path) => path === null || path.startsWith("/usr/")),
  );

  await forgetNonGameDiscoveries();

  expect(invokeMock).toHaveBeenCalledWith("non_game_process_paths", {
    paths: [
      "/usr/libexec/trustd",
      null,
      "/Applications/Stardew Valley.app/Contents/MacOS/Stardew Valley",
    ],
  });
  expect([...useAppStore.getState().exeCache.keys()]).toEqual([
    "stardew valley",
    "suggested",
    "celeste",
  ]);
});
