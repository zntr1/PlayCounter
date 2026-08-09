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
