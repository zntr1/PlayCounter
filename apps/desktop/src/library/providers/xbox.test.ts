import { afterEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { scanXboxLibrary, xboxProvider } from "./xbox";

const endpoint = "https://api.playcounter.test";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Xbox library provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    invokeMock.mockReset();
  });

  it("is available without local detection and exposes one sign-in account", async () => {
    await expect(xboxProvider.detect()).resolves.toEqual({
      provider: "xbox",
      available: true,
      checkedPaths: [],
    });
    await expect(xboxProvider.listAccounts()).resolves.toEqual([
      {
        accountId: 0,
        personaName: "Sign in with Microsoft",
        mostRecent: true,
        gamesWithPlaytime: 0,
      },
    ]);
  });

  it("opens Microsoft sign-in and maps server-resolved games without losing unknown playtime", async () => {
    invokeMock.mockResolvedValue(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          attemptId: "attempt-1",
          authorizeUrl:
            "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "done",
          games: [
            {
              externalId: "1234",
              name: "Forza Horizon 5",
              providerSeconds: null,
              providerLastPlayedAt: "2026-08-31T12:00:00.000Z",
              status: "resolved",
              game: {
                id: 42,
                igdbId: 133430,
                name: "Forza Horizon 5",
                coverUrl: "cover",
                source: "igdb",
              },
              executables: [],
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(scanXboxLibrary({ apiEndpoint: `${endpoint}/` })).resolves.toEqual({
      games: [
        {
          externalId: "1234",
          name: "Forza Horizon 5",
          playtimeSeconds: null,
          lastPlayedUnix: 1_788_177_600,
          installed: false,
          executables: [],
        },
      ],
      warnings: [],
      partial: false,
      resolvedGames: [
        {
          key: "xbox:1234",
          status: "resolved",
          game: {
            id: 42,
            igdbId: 133430,
            name: "Forza Horizon 5",
            coverUrl: "cover",
            source: "igdb",
          },
          executables: [],
        },
      ],
    });
    expect(invokeMock).toHaveBeenCalledWith("open_microsoft_signin_url", {
      url: "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize",
    });
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      `${endpoint}/api/xbox/import/result?attemptId=attempt-1`,
    );
  });

  it("cancels the server attempt when the waiting scan is aborted", async () => {
    invokeMock.mockResolvedValue(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          attemptId: "attempt-2",
          authorizeUrl:
            "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: "pending" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const scan = scanXboxLibrary({ apiEndpoint: endpoint, signal: controller.signal });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    controller.abort();

    await expect(scan).rejects.toThrow("Xbox sign-in was cancelled.");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2][0])).toBe(
      `${endpoint}/api/xbox/import/cancel`,
    );
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      attemptId: "attempt-2",
    });
  });
});
