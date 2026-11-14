import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const { nintendoScanResult } = await import("./nintendoAccount");
const { useKeptLogins } = await import("./keptLogins");

// docs/nintendo-import-plan.md, "What gets built" 2: the scan turns
// Nintendo's games into import entries with no PC file. The games are the
// answer for Phil's account on 2026-11-14, as Rust passes it on.
describe("Nintendo's play history as a scan", () => {
  it("every game becomes one played account game with no PC file", () => {
    useKeptLogins.setState({
      logins: [{ service: "nintendo", name: "Phil", savedAt: 1 }],
    });
    const scan = nintendoScanResult({
      games: [
        {
          titleId: "010040600c5ce000",
          title: "TETRIS 99",
          playtimeSeconds: 16 * 60,
          lastPlayedAt: "2019-12-03T22:20:33Z",
        },
        {
          titleId: "0100000000010000",
          title: "SUPER MARIO ODYSSEY",
          playtimeSeconds: 397 * 60,
          lastPlayedAt: "2018-11-24T03:13:27Z",
        },
      ],
      account: { key: "a08abd5b779f542093ed25f6a2859de2", name: null },
    });
    expect(scan.games).toEqual([
      {
        externalId: "0100000000010000",
        name: "SUPER MARIO ODYSSEY",
        playtimeSeconds: 23_820,
        hasPlayedEvidence: true,
        inAccountLibrary: true,
        lastPlayedUnix: Date.parse("2018-11-24T03:13:27Z") / 1000,
        installed: false,
        executables: [],
      },
      {
        externalId: "010040600c5ce000",
        name: "TETRIS 99",
        playtimeSeconds: 960,
        hasPlayedEvidence: true,
        inAccountLibrary: true,
        lastPlayedUnix: Date.parse("2019-12-03T22:20:33Z") / 1000,
        installed: false,
        executables: [],
      },
    ]);
    expect(scan.partial).toBe(false);
    // The account's name comes with the sign-in.
    expect(scan.account).toEqual({
      key: "a08abd5b779f542093ed25f6a2859de2",
      name: "Phil",
    });
  });

  it("a game Nintendo gave no name keeps its title id and no name", () => {
    const scan = nintendoScanResult({
      games: [
        {
          titleId: "0100abcd00010000",
          title: "",
          playtimeSeconds: null,
          lastPlayedAt: null,
        },
      ],
    });
    expect(scan.games[0]).not.toHaveProperty("name");
    expect(scan.games[0].externalId).toBe("0100abcd00010000");
    expect(scan.games[0].playtimeSeconds).toBeNull();
    expect(scan).not.toHaveProperty("account");
  });
});
