import { afterEach, describe, expect, it, vi } from "vitest";
import { IgdbClient } from "./igdb.js";

afterEach(() => vi.unstubAllGlobals());

describe("IGDB DOS lookup", () => {
  it("uses IGDB search constrained to the DOS platform", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify([{ id: 1, name: "Doom", platforms: [13] }]),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new IgdbClient({ clientId: "client", accessToken: "token" });

    await expect(client.findDosGames("Doom")).resolves.toEqual([
      { id: 1, name: "Doom", platforms: [13] },
    ]);
    const request = fetchMock.mock.calls[0];
    expect(request[0]).toBe("https://api.igdb.com/v4/games");
    expect((request[1] as RequestInit).body).toContain('search "Doom";');
    expect((request[1] as RequestInit).body).toContain(
      "where platforms = (13);",
    );
    expect((request[1] as RequestInit).body).toContain("limit 50;");
  });

  it("supports a registry-supplied set of guest platforms", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify([{ id: 2, name: "F-Zero GX" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new IgdbClient({ clientId: "client", accessToken: "token" });

    await client.findGamesForPlatforms("F-Zero GX", [5, 21], 25);

    const request = fetchMock.mock.calls[0];
    expect((request[1] as RequestInit).body).toContain(
      "where platforms = (5,21);",
    );
    expect((request[1] as RequestInit).body).toContain("limit 25;");
  });
});

describe("IGDB game search", () => {
  it("supports large paginated result sets", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify([{ id: 1, name: "Need for Speed" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new IgdbClient({ clientId: "client", accessToken: "token" });

    await client.searchGames("Need for Speed", 41, 40);

    const request = fetchMock.mock.calls[0];
    expect((request[1] as RequestInit).body).toContain("limit 41;");
    expect((request[1] as RequestInit).body).toContain("offset 40;");
  });

  it("filters by first release date", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new IgdbClient({ clientId: "client", accessToken: "token" });

    await client.searchGames("Need for Speed", 41, 0, {
      releaseYear: 2015,
      sort: "release-desc",
    });

    const body = (fetchMock.mock.calls[0][1] as RequestInit).body;
    expect(body).toContain(
      "where name != null & first_release_date >= 1420070400 & first_release_date < 1451606400;",
    );
    expect(body).not.toContain("sort first_release_date");
  });

  it("sorts the complete IGDB search window locally before paginating", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            { id: 1, name: "Unknown date" },
            { id: 2, name: "Old", first_release_date: 946684800 },
            { id: 3, name: "New", first_release_date: 1577836800 },
          ]),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new IgdbClient({ clientId: "client", accessToken: "token" });

    const games = await client.searchGames("Need for Speed", 2, 0, {
      sort: "release-desc",
    });

    expect(games.map((game) => game.name)).toEqual(["New", "Old"]);
    const body = (fetchMock.mock.calls[0][1] as RequestInit).body;
    expect(body).toContain("limit 500;");
    expect(body).toContain("offset 0;");
    expect(body).not.toContain("sort first_release_date");
  });
});
