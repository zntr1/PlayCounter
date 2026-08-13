import type { ContributionsResponse } from "@playcounter/shared";
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
            emulatorId: "dolphin",
            contentKind: "program",
            contentValue: "C:\\private\\doom.exe",
          },
        ],
      },
    });
    expect(result.statusCode).toBe(400);
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
  });
});
