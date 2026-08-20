import type {
  ContributionsResponse,
  IdentifierReportResponse,
  IgnoredProcessReportResponse,
} from "@playcounter/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import { MemoryRepository } from "./repository.js";

const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("community contributions route", () => {
  it("rejects a missing or malformed install UUID", async () => {
    const app = await buildApp(new MemoryRepository());
    apps.push(app);

    const missing = await app.inject({
      method: "GET",
      url: "/api/community/contributions",
    });
    const malformed = await app.inject({
      method: "GET",
      url: "/api/community/contributions?installUuid=not-a-uuid",
    });

    expect(missing.statusCode).toBe(400);
    expect(malformed.statusCode).toBe(400);
  });

  it("passes the UUID to the repository and returns its response shape", async () => {
    const response: ContributionsResponse = {
      items: [
        {
          platform: "windows",
          kind: "exe",
          value: "Game.exe",
          gameId: 42,
          gameName: "Game",
          coverUrl: "https://images.igdb.com/example.jpg",
          status: "rejected",
          reviewNote: "Wrong game",
          reviewedAt: "2026-08-09T10:00:00.000Z",
          createdAt: "2026-08-08T10:00:00.000Z",
        },
      ],
      counts: { suggested: 1, verified: 0, pending: 0, rejected: 1 },
      emulator: {
        items: [
          {
            emulatorId: "dosbox",
            contentKind: "program",
            contentValue: "doom.exe",
            gameId: 43,
            gameName: "Doom",
            coverUrl: "https://images.igdb.com/doom.jpg",
            status: "verified",
            reviewedAt: "2026-08-09T10:00:00.000Z",
            createdAt: "2026-08-08T10:00:00.000Z",
          },
        ],
        counts: { suggested: 1, verified: 1, pending: 0, rejected: 0 },
      },
    };
    class ContributionsRepository extends MemoryRepository {
      override listContributions = vi.fn(async () => response);
    }
    const repository = new ContributionsRepository();
    const app = await buildApp(repository);
    apps.push(app);
    const uuid = "550e8400-e29b-41d4-a716-446655440000";

    const result = await app.inject({
      method: "GET",
      url: `/api/community/contributions?installUuid=${uuid}`,
    });

    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual(response);
    expect(repository.listContributions).toHaveBeenCalledWith(uuid);
  });
});

describe("emulator suggestion route", () => {
  const installUuid = "550e8400-e29b-41d4-a716-446655440000";

  it("forwards exactly a privacy-bounded emulator mapping", async () => {
    class SuggestionRepository extends MemoryRepository {
      override suggestEmulatorContent = vi.fn(async () => ({
        status: "pending" as const,
      }));
    }
    const repository = new SuggestionRepository();
    const app = await buildApp(repository);
    apps.push(app);
    const payload = {
      emulatorId: "dosbox",
      contentKind: "program",
      contentValue: "doom3.exe",
      gameId: 42,
      installUuid,
    };

    const result = await app.inject({
      method: "POST",
      url: "/api/emulator/suggestions",
      payload,
    });

    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ status: "pending" });
    expect(repository.suggestEmulatorContent).toHaveBeenCalledWith(payload);
    expect(
      Object.keys(repository.suggestEmulatorContent.mock.calls[0][0]).sort(),
    ).toEqual([
      "contentKind",
      "contentValue",
      "emulatorId",
      "gameId",
      "installUuid",
    ]);
  });

  it("rejects private, unsupported, custom, and expanded payloads", async () => {
    const app = await buildApp(new MemoryRepository());
    apps.push(app);
    const base = {
      emulatorId: "dosbox",
      contentKind: "program",
      contentValue: "doom3.exe",
      gameId: 42,
      installUuid,
    };
    const invalid = [
      { ...base, display: "private window title" },
      { ...base, contentKind: "folder" },
      { ...base, contentKind: "rom" },
      { ...base, contentValue: "C:\\Games\\doom3.exe" },
      { ...base, gameId: -1_000_000_001 },
      { ...base, installUuid: "not-a-uuid" },
      { ...base, emulatorId: "pcsx2" },
    ];

    for (const payload of invalid) {
      const result = await app.inject({
        method: "POST",
        url: "/api/emulator/suggestions",
        payload,
      });
      expect(result.statusCode).toBe(400);
    }
  });
});

describe("community metadata route", () => {
  it("returns a page and exposes the offset for remaining IGDB matches", async () => {
    class MetadataRepository extends MemoryRepository {
      override searchCommunityMetadata = vi.fn(
        async (_query: string, limit = 10, offset = 0) =>
          Array.from({ length: limit }, (_, index) => ({
            igdbId: offset + index + 1,
            name: `Need for Speed ${offset + index + 1}`,
            coverUrl: "",
          })),
      );
    }
    const repository = new MetadataRepository();
    const app = await buildApp(repository);
    apps.push(app);

    const result = await app.inject({
      method: "GET",
      url: "/api/community/metadata?query=Need%20for%20Speed&offset=40&releaseYear=2015&sort=release-desc",
    });

    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({
      hasMore: true,
      nextOffset: 80,
    });
    expect(result.json().candidates).toHaveLength(40);
    expect(repository.searchCommunityMetadata).toHaveBeenCalledWith(
      "Need for Speed",
      41,
      40,
      { releaseYear: 2015, sort: "release-desc" },
    );
  });

  it("rejects invalid pagination and release filter values", async () => {
    const app = await buildApp(new MemoryRepository());
    apps.push(app);

    for (const url of [
      "/api/community/metadata?query=Need%20for%20Speed&offset=-1",
      "/api/community/metadata?query=Need%20for%20Speed&releaseYear=1949",
      "/api/community/metadata?query=Need%20for%20Speed&sort=popular",
    ]) {
      const result = await app.inject({ method: "GET", url });
      expect(result.statusCode).toBe(400);
    }
  });
});

describe("identifier report route", () => {
  const uuid = "550e8400-e29b-41d4-a716-446655440000";

  it("validates identity fields and executable file names", async () => {
    const app = await buildApp(new MemoryRepository());
    apps.push(app);
    const invalidPayloads = [
      { exeName: "ai.exe", reason: "not_a_game" },
      {
        exeName: "ai.exe",
        reason: "not_a_game",
        installUuid: "not-a-uuid",
      },
      {
        exeName: "ai.exe",
        reason: "unknown",
        installUuid: uuid,
      },
      ...[
        "C:\\Games\\ai.exe",
        "../ai.exe",
        "sub/dir/ai.exe",
        "ai\u0000.exe",
        "ai\nexe",
        "*",
        ".",
      ].map((exeName) => ({
        exeName,
        reason: "not_a_game",
        installUuid: uuid,
      })),
    ];

    for (const payload of invalidPayloads) {
      const result = await app.inject({
        method: "POST",
        url: "/api/community/identifier-reports",
        payload,
      });
      expect(result.statusCode).toBe(400);
    }
  });

  it("normalizes and forwards reports with or without a game identity", async () => {
    const response: IdentifierReportResponse = {
      status: "recorded",
      flagged: false,
    };
    class ReportRepository extends MemoryRepository {
      override reportIdentifier = vi.fn(async () => response);
    }
    const repository = new ReportRepository();
    const app = await buildApp(repository);
    apps.push(app);

    const matched = await app.inject({
      method: "POST",
      url: "/api/community/identifier-reports",
      payload: {
        exeName: "  AI.EXE  ",
        reason: "not_a_game",
        gameId: 42,
        gameSource: "igdb",
        installUuid: uuid,
      },
    });
    const ambiguous = await app.inject({
      method: "POST",
      url: "/api/community/identifier-reports",
      payload: {
        exeName: "launcher",
        reason: "not_a_game",
        installUuid: uuid,
      },
    });

    expect(matched.statusCode).toBe(200);
    expect(ambiguous.statusCode).toBe(200);
    expect(matched.json()).toEqual(response);
    expect(repository.reportIdentifier).toHaveBeenNthCalledWith(1, {
      exeName: "ai.exe",
      reason: "not_a_game",
      gameId: 42,
      gameSource: "igdb",
      installUuid: uuid,
    });
    expect(repository.reportIdentifier).toHaveBeenNthCalledWith(2, {
      exeName: "launcher",
      reason: "not_a_game",
      installUuid: uuid,
    });
  });
});

describe("ignored process routes", () => {
  const uuid = "550e8400-e29b-41d4-a716-446655440000";

  it("normalizes and forwards system-ignore suggestions", async () => {
    const response: IgnoredProcessReportResponse = {
      status: "recorded",
    };
    class IgnoreRepository extends MemoryRepository {
      override reportIgnoredProcess = vi.fn(async () => response);
    }
    const repository = new IgnoreRepository();
    const app = await buildApp(repository);
    apps.push(app);

    const result = await app.inject({
      method: "POST",
      url: "/api/community/ignored-processes",
      payload: {
        exeName: "  SERVICE.EXE  ",
        platform: "windows",
        installUuid: uuid,
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual(response);
    expect(repository.reportIgnoredProcess).toHaveBeenCalledWith({
      exeName: "service.exe",
      platform: "windows",
      installUuid: uuid,
    });
  });

  it("rejects invalid or over-broad system-ignore suggestions", async () => {
    const app = await buildApp(new MemoryRepository());
    apps.push(app);
    const payloads = [
      { exeName: "ai.exe", platform: "windows" },
      { exeName: "ai.exe", platform: "unknown", installUuid: uuid },
      { exeName: "ai.exe", platform: "windows", installUuid: "bad" },
      ...["ai*.exe", "ai?.exe", "C:\\Games\\ai.exe", "ai\n.exe", "."].map(
        (exeName) => ({ exeName, platform: "windows", installUuid: uuid }),
      ),
      {
        exeName: "ai.exe",
        platform: "windows",
        installUuid: uuid,
        gameId: 42,
      },
    ];
    for (const payload of payloads) {
      const result = await app.inject({
        method: "POST",
        url: "/api/community/ignored-processes",
        payload,
      });
      expect(result.statusCode).toBe(400);
    }
  });

  it("does not expose reviewed suggestions as a distributed ignore list", async () => {
    const app = await buildApp(new MemoryRepository());
    apps.push(app);

    const result = await app.inject({
      method: "GET",
      url: "/api/community/ignored-processes",
    });
    expect(result.statusCode).toBe(404);
  });
});

describe("emulator resolution route", () => {
  it("passes normalized content references to the dedicated repository path", async () => {
    class EmulatorRepository extends MemoryRepository {
      override resolveEmulatorContent = vi.fn(async (items) =>
        items.map((item) => ({
          key: item.key,
          confidence: "unknown" as const,
          game: null,
        })),
      );
    }
    const repository = new EmulatorRepository();
    const app = await buildApp(repository);
    apps.push(app);

    const result = await app.inject({
      method: "POST",
      url: "/api/emulator/resolve",
      payload: {
        items: [
          {
            key: "dosbox:program:doom.exe",
            emulatorId: "dosbox",
            contentKind: "program",
            contentValue: "doom.exe",
          },
        ],
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({
      results: [
        {
          key: "dosbox:program:doom.exe",
          confidence: "unknown",
          game: null,
        },
      ],
    });
    expect(repository.resolveEmulatorContent).toHaveBeenCalledOnce();
  });

  it("rejects paths and unsupported emulator identifiers", async () => {
    const app = await buildApp(new MemoryRepository());
    apps.push(app);
    const result = await app.inject({
      method: "POST",
      url: "/api/emulator/resolve",
      payload: {
        items: [
          {
            key: "bad",
            emulatorId: "pcsx2",
            contentKind: "program",
            contentValue: "C:\\private\\doom.exe",
          },
        ],
      },
    });
    expect(result.statusCode).toBe(400);
  });

  it("accepts Dolphin ROM identities and rejects cross-emulator kinds", async () => {
    const app = await buildApp(new MemoryRepository());
    apps.push(app);
    const accepted = await app.inject({
      method: "POST",
      url: "/api/emulator/resolve",
      payload: {
        items: [
          {
            key: "dolphin:rom:metroid prime.rvz",
            emulatorId: "DOLPHIN",
            contentKind: "rom",
            contentValue: "luigi's mansion.rvz",
            searchHint: "Luigi's Mansion",
          },
        ],
      },
    });
    const rejected = await app.inject({
      method: "POST",
      url: "/api/emulator/resolve",
      payload: {
        items: [
          {
            key: "dolphin:program:metroid.exe",
            emulatorId: "dolphin",
            contentKind: "program",
            contentValue: "metroid.exe",
          },
        ],
      },
    });

    expect(accepted.statusCode).toBe(200);
    expect(rejected.statusCode).toBe(400);
  });

  it("uses the emulator-specific game search", async () => {
    class EmulatorSearchRepository extends MemoryRepository {
      override searchEmulatorGames = vi.fn(async () => [
        {
          id: 42,
          igdbId: 9,
          name: "Doom",
          coverUrl: "",
          source: "igdb" as const,
          releaseYear: 1993,
        },
      ]);
    }
    const repository = new EmulatorSearchRepository();
    const app = await buildApp(repository);
    apps.push(app);

    const result = await app.inject({
      method: "GET",
      url: "/api/emulator/games/search?emulatorId=dosbox&query=Doom",
    });

    expect(result.statusCode).toBe(200);
    expect(result.json().games[0]).toMatchObject({
      name: "Doom",
      releaseYear: 1993,
    });
    expect(repository.searchEmulatorGames).toHaveBeenCalledWith(
      "dosbox",
      "Doom",
    );

    const dolphinResult = await app.inject({
      method: "GET",
      url: "/api/emulator/games/search?emulatorId=dolphin&query=Metroid%20Prime",
    });
    expect(dolphinResult.statusCode).toBe(200);
    expect(repository.searchEmulatorGames).toHaveBeenLastCalledWith(
      "dolphin",
      "Metroid Prime",
    );
  });
});
