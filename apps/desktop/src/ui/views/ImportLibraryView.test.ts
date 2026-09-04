import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ImportLibraryView, {
  canImportScannedGame,
  importGroupForGame,
  ImportRow,
  hasImportableActivity,
  XboxMatchControls,
  xboxScanLabel,
} from "./ImportLibraryView";

it("exposes the importer as the lazy-load default component", () => {
  expect(ImportLibraryView).toBeTypeOf("function");
});

it("shows the current Xbox import stage", () => {
  expect(xboxScanLabel("authorization")).toBe("Waiting for Microsoft sign-in…");
  expect(xboxScanLabel("history")).toBe("Reading your Xbox history…");
});

describe("library importer eligibility", () => {
  it("lets both providers import an existing entry again to refresh playtime", () => {
    const game = {
      externalId: "730",
      name: "Counter-Strike 2",
      playtimeSeconds: 7_200,
      installed: false,
      executables: [],
    };
    const resolved = {
      key: "steam:730",
      status: "resolved" as const,
      game: {
        id: 3,
        igdbId: 1_372,
        name: "Counter-Strike 2",
        coverUrl: "cover",
        source: "igdb" as const,
      },
      executables: [],
    };

    expect(
      canImportScannedGame({ game, resolved, alreadyImported: true }),
    ).toBe(true);
    expect(
      canImportScannedGame({ game, resolved, alreadyImported: false }),
    ).toBe(true);
    expect(
      canImportScannedGame({
        game: { ...game, playtimeSeconds: 0 },
        resolved,
        alreadyImported: true,
      }),
    ).toBe(false);
  });

  it("keeps an already imported game in the Imported group for both providers", () => {
    const game = {
      externalId: "1234",
      name: "Yakuza 0",
      playtimeSeconds: 3_600,
      installed: false,
      executables: [],
    };
    const resolved = {
      key: "xbox:1234",
      status: "resolved" as const,
      game: {
        id: 7,
        igdbId: 133_430,
        name: "Yakuza 0",
        coverUrl: "cover",
        source: "igdb" as const,
      },
      executables: [],
    };

    expect(
      importGroupForGame({
        game,
        provider: "xbox",
        resolved,
        alreadyImported: true,
      }),
    ).toBe("imported");
    expect(
      importGroupForGame({
        game,
        provider: "steam",
        resolved,
        alreadyImported: true,
      }),
    ).toBe("imported");
    expect(
      importGroupForGame({
        game,
        provider: "xbox",
        resolved,
        alreadyImported: false,
      }),
    ).toBe("ready");
  });

  it("sorts unresolved, inactive, and completed games into their groups", () => {
    const game = {
      externalId: "1234",
      name: "Yakuza 0",
      playtimeSeconds: 3_600,
      installed: false,
      executables: [],
    };

    expect(
      importGroupForGame({
        game,
        provider: "xbox",
        resolved: {
          key: "xbox:1234",
          status: "unknown",
          executables: [],
          candidates: [],
        },
        alreadyImported: false,
      }),
    ).toBe("attention");
    expect(
      importGroupForGame({
        game: { ...game, playtimeSeconds: 0 },
        provider: "xbox",
        alreadyImported: false,
      }),
    ).toBe("unavailable");
    expect(
      importGroupForGame({
        game,
        provider: "xbox",
        alreadyImported: false,
        completed: true,
      }),
    ).toBe("imported");
  });

  it("keeps unknown Xbox duration importable but rejects an untouched zero", () => {
    expect(
      hasImportableActivity({
        externalId: "42",
        playtimeSeconds: null,
        installed: false,
        executables: [],
      }),
    ).toBe(true);
    expect(
      hasImportableActivity({
        externalId: "42",
        playtimeSeconds: 0,
        installed: false,
        executables: [],
      }),
    ).toBe(false);
    expect(
      hasImportableActivity({
        externalId: "42",
        playtimeSeconds: 0,
        lastPlayedUnix: 1_700_000_000,
        installed: false,
        executables: [],
      }),
    ).toBe(true);
  });

  it("lets an installed imported game refresh its playtime without picking a file", () => {
    const game = {
      externalId: "629270283",
      name: "Gang Beasts",
      playtimeSeconds: 14_000,
      installed: true,
      installPath: String.raw`D:\XboxGames\Gang Beasts\Content`,
      executables: [
        {
          fileName: "Gang Beasts.exe",
          relativePath: "Gang Beasts.exe",
          sizeBytes: 1_000_000,
          depth: 0,
          declared: true,
        },
      ],
    };
    const resolved = {
      key: "xbox:629270283",
      status: "resolved" as const,
      game: {
        id: 18_537,
        igdbId: 18_537,
        name: "Gang Beasts",
        coverUrl: "cover",
        source: "igdb" as const,
      },
      executables: [],
    };

    expect(
      canImportScannedGame({
        game,
        resolved,
        alreadyImported: true,
      }),
    ).toBe(true);
    expect(
      canImportScannedGame({
        game,
        resolved,
        alreadyImported: false,
      }),
    ).toBe(false);
  });

  it("offers the game file picker on an imported row without Add and Share", () => {
    const html = renderToStaticMarkup(
      createElement(ImportRow, {
        provider: "xbox",
        apiEndpoint: "https://api.example",
        game: {
          externalId: "629270283",
          name: "Gang Beasts",
          playtimeSeconds: 14_000,
          installed: true,
          installPath: String.raw`D:\XboxGames\Gang Beasts\Content`,
          executables: [
            {
              fileName: "Gang Beasts.exe",
              relativePath: "Gang Beasts.exe",
              sizeBytes: 1_000_000,
              depth: 0,
              declared: true,
            },
          ],
        },
        resolved: {
          key: "xbox:629270283",
          status: "resolved",
          game: {
            id: 18_537,
            igdbId: 18_537,
            name: "Gang Beasts",
            coverUrl: "",
            source: "igdb",
          },
          executables: [],
        },
        selected: false,
        alreadyImported: true,
        showSelection: true,
        showExecutableChoice: true,
        showAddAndShare: false,
        addingAndSharing: false,
        browsing: false,
        ignoredProcesses: new Set<string>(),
        onXboxMatch: async () => undefined,
        onAddAndShare: () => undefined,
        onBrowseExecutable: () => undefined,
        onManualExecutable: () => undefined,
        onSelected: () => undefined,
      }),
    );

    expect(html).toContain('type="checkbox"');
    expect(html).toContain("Gang Beasts.exe");
    expect(html).toContain("then import this game again to save it");
    expect(html).not.toContain("Add and Share");
  });

  it("tells an imported row that importing it again refreshes playtime", () => {
    const props = {
      apiEndpoint: "https://api.example",
      game: {
        externalId: "1234",
        name: "Yakuza 0",
        playtimeSeconds: 3_600,
        installed: false,
        executables: [],
      },
      resolved: {
        key: "xbox:1234",
        status: "resolved" as const,
        game: {
          id: 7,
          igdbId: 133_430,
          name: "Yakuza 0",
          coverUrl: "",
          source: "igdb" as const,
        },
        executables: [],
      },
      selected: false,
      alreadyImported: true,
      showExecutableChoice: false,
      showAddAndShare: false,
      addingAndSharing: false,
      browsing: false,
      ignoredProcesses: new Set<string>(),
      onXboxMatch: async () => undefined,
      onAddAndShare: () => undefined,
      onBrowseExecutable: () => undefined,
      onManualExecutable: () => undefined,
      onSelected: () => undefined,
    };

    expect(
      renderToStaticMarkup(
        createElement(ImportRow, {
          ...props,
          provider: "xbox",
          showSelection: true,
        }),
      ),
    ).toContain("Already in My Games · import again to update playtime");
    expect(
      renderToStaticMarkup(
        createElement(ImportRow, {
          ...props,
          provider: "steam",
          showSelection: true,
        }),
      ),
    ).toContain("Already in My Games · import again to update playtime");
  });

  it("does not reserve empty artwork for an unresolved Xbox title", () => {
    const html = renderToStaticMarkup(
      createElement(ImportRow, {
        provider: "xbox",
        apiEndpoint: "https://api.example",
        game: {
          externalId: "964706972",
          name: "No Man's Sky",
          playtimeSeconds: 0,
          installed: false,
          executables: [],
        },
        resolved: {
          key: "xbox:964706972",
          status: "unknown",
          executables: [],
          candidates: [],
        },
        selected: false,
        alreadyImported: false,
        showSelection: false,
        showExecutableChoice: false,
        showAddAndShare: false,
        addingAndSharing: false,
        browsing: false,
        ignoredProcesses: new Set<string>(),
        onXboxMatch: async () => undefined,
        onAddAndShare: () => undefined,
        onBrowseExecutable: () => undefined,
        onManualExecutable: () => undefined,
        onSelected: () => undefined,
      }),
    );

    expect(html).toContain("No Man&#x27;s Sky");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<svg");
  });

  it("renders the selected Xbox candidate cover", () => {
    const html = renderToStaticMarkup(
      createElement(XboxMatchControls, {
        apiEndpoint: "https://api.example",
        candidates: [
          {
            id: 42,
            igdbId: 133430,
            name: "Forza Horizon 5",
            coverUrl: "https://images.example/forza.jpg",
            releaseYear: 2021,
            source: "igdb",
          },
        ],
        title: "Forza Horizon 5",
        importing: false,
        onConfirm: async () => undefined,
      }),
    );

    expect(html).toContain('src="https://images.example/forza.jpg"');
    expect(html).toContain('alt="Forza Horizon 5 cover"');
    expect(html).toContain("2021");
    expect(html).not.toContain("Released 2021");
    expect(html).toContain("Confirm and Import");
  });

  it("preselects a declared Xbox executable before identity confirmation", () => {
    const html = renderToStaticMarkup(
      createElement(ImportRow, {
        provider: "xbox",
        apiEndpoint: "https://api.example",
        game: {
          externalId: "1234",
          name: "Forza Horizon 5",
          playtimeSeconds: null,
          installed: true,
          installPath: String.raw`C:\XboxGames\Forza Horizon 5\Content`,
          executables: [
            {
              fileName: "ForzaHorizon5.exe",
              relativePath: "ForzaHorizon5.exe",
              sizeBytes: 1_000_000,
              depth: 0,
              declared: true,
            },
          ],
        },
        resolved: {
          key: "xbox:1234",
          status: "unknown",
          executables: [],
          candidates: [],
        },
        selected: false,
        alreadyImported: false,
        showSelection: false,
        showExecutableChoice: true,
        showAddAndShare: true,
        addingAndSharing: false,
        browsing: false,
        manualExecutable: "ForzaHorizon5.exe",
        ignoredProcesses: new Set<string>(),
        onXboxMatch: async () => undefined,
        onAddAndShare: () => undefined,
        onBrowseExecutable: () => undefined,
        onManualExecutable: () => undefined,
        onSelected: () => undefined,
      }),
    );

    expect(html).toContain('value="ForzaHorizon5.exe" selected=""');
    expect(html).toContain("Confirm and Import");
    expect(html).not.toContain("Add and Share");
  });
});
