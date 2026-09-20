import { afterEach, expect, it, vi } from "vitest";
import { searchLibraryGames } from "./gameLookup";

afterEach(() => vi.unstubAllGlobals());

it.each([
  ["Warcraft® III: Reign of Chaos®", "Warcraft III: Reign of Chaos"],
  ["  Diablo™  II: Lord of Destruction℠  ", "Diablo II: Lord of Destruction"],
  ["Pokémon: Let's Go, Évoli!", "Pokémon: Let's Go, Évoli!"],
])(
  "searches %s without trademark noise or removing meaningful characters",
  async (title, query) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ games: [] })));
    vi.stubGlobal("fetch", fetchMock);
    await searchLibraryGames("https://search.example", title, {
      mainGamesAndRemastersOnly: false,
    });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("query")).toBe(query);
    expect(url.searchParams.get("mainGamesAndRemastersOnly")).toBe("false");
  },
);

it("does not request an empty search after removing trademark symbols", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  expect(
    await searchLibraryGames("https://search.example", "® ™ ℠", {
      mainGamesAndRemastersOnly: false,
    }),
  ).toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled();
});
