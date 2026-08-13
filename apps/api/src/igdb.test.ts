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
});
