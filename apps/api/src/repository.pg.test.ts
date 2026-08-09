import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { IgdbClient } from "./igdb.js";
import { PostgresRepository } from "./repository.js";

const connectionString = process.env.PGTEST_URL;
const describePg = connectionString ? describe : describe.skip;

describePg("community review PostgreSQL integration", () => {
  const pool = new pg.Pool({ connectionString });
  const repositories: PostgresRepository[] = [];
  const gameIds: number[] = [];

  beforeAll(async () => {
    const result = await pool.query<{ exists: boolean }>(
      `SELECT to_regclass('community_identifier_submissions') IS NOT NULL AS exists`,
    );
    if (!result.rows[0]?.exists) {
      throw new Error(
        "PGTEST_URL must point to a database with migration 011 applied",
      );
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    if (gameIds.length > 0) {
      await pool.query(
        "DELETE FROM community_games WHERE id = ANY($1::int[])",
        [gameIds.splice(0)],
      );
    }
    await Promise.all(
      repositories.splice(0).map((repository) => repository.close()),
    );
  });

  async function createGame() {
    const result = await pool.query<{ id: number }>(
      `INSERT INTO community_games (name, cover_url, verified)
       VALUES ($1, $2, false) RETURNING id`,
      [`PG test ${randomUUID()}`, "https://images.igdb.com/test.jpg"],
    );
    gameIds.push(result.rows[0].id);
    return result.rows[0].id;
  }

  function repository() {
    const instance = new PostgresRepository(
      connectionString!,
      new IgdbClient({}),
    );
    repositories.push(instance);
    return instance;
  }

  it("attributes duplicate submissions and preserves a rejected re-submission", async () => {
    const repo = repository();
    const suffix = randomUUID();
    const payload = {
      exeName: `Race-${suffix}.exe`,
      name: `Game ${suffix}`,
      coverUrl:
        "https://images.igdb.com/igdb/image/upload/t_cover_big/test.jpg",
      igdbId: Math.floor(Math.random() * 1_000_000_000) + 1,
      installUuid: randomUUID(),
    };
    const first = await repo.suggestCommunityGame(payload);
    expect(first.id).toBeTypeOf("number");
    gameIds.push(first.id!);
    const secondInstall = randomUUID();
    await repo.suggestCommunityGame({ ...payload, installUuid: secondInstall });
    expect(
      (await repo.listContributions(payload.installUuid)).counts.suggested,
    ).toBe(1);
    expect((await repo.listContributions(secondInstall)).counts.suggested).toBe(
      1,
    );

    await pool.query(
      `UPDATE community_game_identifiers
       SET verified = false, status = 'rejected', review_note = 'Wrong game', reviewed_at = now()
       WHERE game_id = $1`,
      [first.id],
    );
    const rejected = await repo.suggestCommunityGame({
      ...payload,
      exeName: payload.exeName.toUpperCase(),
    });
    expect(rejected).toMatchObject({
      id: first.id,
      verified: false,
      rejected: true,
      reviewNote: "Wrong game",
    });
    const matches = await repo.matchProcesses([
      {
        key: payload.exeName.toLowerCase(),
        identifiers: [
          { platform: "windows", kind: "exe", value: payload.exeName },
        ],
      },
    ]);
    expect(matches.has(payload.exeName.toLowerCase())).toBe(false);
  });

  it("returns the conflicting expression-index tuple after an overlapping insert", async () => {
    const gameId = await createGame();
    const exe = `Overlap-${randomUUID()}.exe`;
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await first.query("BEGIN");
      await first.query(
        `INSERT INTO community_game_identifiers
           (platform, kind, value, game_id, verified, status)
         VALUES ('windows', 'exe', $1, $2, false, 'pending')`,
        [exe, gameId],
      );
      const waiting = second.query<{ value: string }>(
        `INSERT INTO community_game_identifiers
           (platform, kind, value, game_id, verified, status)
         VALUES ('windows', 'exe', $1, $2, false, 'pending')
         ON CONFLICT (lower(platform), lower(kind), lower(value), game_id)
         DO UPDATE SET platform = community_game_identifiers.platform
         RETURNING value`,
        [exe.toUpperCase(), gameId],
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
      await first.query("COMMIT");
      expect((await waiting).rows[0]?.value).toBe(exe);
    } finally {
      await first.query("ROLLBACK").catch(() => undefined);
      first.release();
      second.release();
    }
  });

  it("cascades legacy casing updates to submissions", async () => {
    const gameId = await createGame();
    const exe = `Case-${randomUUID()}.exe`;
    await pool.query(
      `INSERT INTO community_game_identifiers
         (platform, kind, value, game_id, verified, status)
       VALUES ('windows', 'exe', $1, $2, false, 'pending')`,
      [exe, gameId],
    );
    await pool.query(
      `INSERT INTO community_identifier_submissions
         (platform, kind, value, game_id, install_uuid)
       VALUES ('windows', 'exe', $1, $2, $3)`,
      [exe, gameId, randomUUID()],
    );
    const recased = exe.toUpperCase();
    await pool.query(
      `INSERT INTO community_game_identifiers
         (platform, kind, value, game_id, verified)
       VALUES ('WINDOWS', 'EXE', $1, $2, false)
       ON CONFLICT (lower(platform), lower(kind), lower(value), game_id)
       DO UPDATE SET platform = excluded.platform,
                     kind = excluded.kind,
                     value = excluded.value`,
      [recased, gameId],
    );
    const result = await pool.query<{
      platform: string;
      kind: string;
      value: string;
    }>(
      `SELECT platform, kind, value FROM community_identifier_submissions
       WHERE game_id = $1`,
      [gameId],
    );
    expect(result.rows[0]).toEqual({
      platform: "WINDOWS",
      kind: "EXE",
      value: recased,
    });
  });

  it("syncs legacy approval and refuses contradictory explicit state", async () => {
    const gameId = await createGame();
    const exe = `Trigger-${randomUUID()}.exe`;
    await pool.query(
      `INSERT INTO community_game_identifiers
         (platform, kind, value, game_id, verified, status, review_note)
       VALUES ('windows', 'exe', $1, $2, false, 'rejected', 'Old reason')`,
      [exe, gameId],
    );
    const approved = await pool.query<{
      status: string;
      review_note: string | null;
      reviewed_at: Date | null;
    }>(
      `UPDATE community_game_identifiers SET verified = true
       WHERE game_id = $1 RETURNING status, review_note, reviewed_at`,
      [gameId],
    );
    expect(approved.rows[0]).toMatchObject({
      status: "verified",
      review_note: null,
    });
    expect(approved.rows[0].reviewed_at).toBeInstanceOf(Date);
    const explicitlyRejected = await pool.query<{
      status: string;
      verified: boolean;
    }>(
      `UPDATE community_game_identifiers
       SET verified = false, status = 'rejected', review_note = 'Explicit'
       WHERE game_id = $1 RETURNING status, verified`,
      [gameId],
    );
    expect(explicitlyRejected.rows[0]).toEqual({
      status: "rejected",
      verified: false,
    });
    await pool.query(
      `UPDATE community_game_identifiers
       SET verified = false, status = 'pending' WHERE game_id = $1`,
      [gameId],
    );
    await expect(
      pool.query(
        `UPDATE community_game_identifiers
         SET verified = true, status = 'rejected' WHERE game_id = $1`,
        [gameId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
