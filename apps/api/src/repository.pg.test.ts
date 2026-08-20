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
  const igdbGameIds: number[] = [];
  const identifierValues: string[] = [];

  beforeAll(async () => {
    const result = await pool.query<{ exists: boolean }>(
      `SELECT to_regclass('problematic_game_identifiers') IS NOT NULL
          AND to_regclass('community_ignored_process_reports') IS NOT NULL
          AND to_regclass('emulator_content_suggestions') IS NOT NULL
          AND to_regclass('emulator_content_submissions') IS NOT NULL AS exists`,
    );
    if (!result.rows[0]?.exists) {
      throw new Error(
        "PGTEST_URL must point to a database with migration 017 applied",
      );
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    if (identifierValues.length > 0) {
      const values = identifierValues.splice(0);
      await pool.query(
        "DELETE FROM emulator_content_identifiers WHERE content_value = ANY($1::text[])",
        [values],
      );
      await pool.query(
        "DELETE FROM emulator_content_suggestions WHERE content_value = ANY($1::text[])",
        [values],
      );
      await pool.query(
        "DELETE FROM community_ignored_process_reports WHERE value = ANY($1::text[])",
        [values],
      );
      await pool.query(
        "DELETE FROM community_identifier_reports WHERE value = ANY($1::text[])",
        [values],
      );
      await pool.query(
        "DELETE FROM problematic_game_identifiers WHERE value = ANY($1::text[])",
        [values],
      );
      await pool.query(
        "DELETE FROM igdb_ambiguous_game_identifiers WHERE lower(value) = ANY($1::text[])",
        [values],
      );
      await pool.query(
        "DELETE FROM igdb_game_identifiers WHERE lower(value) = ANY($1::text[])",
        [values],
      );
    }
    if (gameIds.length > 0) {
      await pool.query(
        "DELETE FROM community_games WHERE id = ANY($1::int[])",
        [gameIds.splice(0)],
      );
    }
    if (igdbGameIds.length > 0) {
      await pool.query("DELETE FROM igdb_games WHERE id = ANY($1::int[])", [
        igdbGameIds.splice(0),
      ]);
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

  function repository(igdb: IgdbClient = new IgdbClient({})) {
    const instance = new PostgresRepository(connectionString!, igdb);
    repositories.push(instance);
    return instance;
  }

  function identifierValue(prefix: string) {
    const value = `${prefix}-${randomUUID()}.exe`;
    identifierValues.push(value.toLowerCase());
    return value;
  }

  async function createIgdbGame(name = `IGDB test ${randomUUID()}`) {
    const igdbId = Math.floor(Math.random() * 1_000_000_000) + 1;
    const result = await pool.query<{ id: number }>(
      `INSERT INTO igdb_games (igdb_id, name, cover_url)
       VALUES ($1, $2, '') RETURNING id`,
      [igdbId, name],
    );
    igdbGameIds.push(result.rows[0].id);
    return { id: result.rows[0].id, igdbId, name };
  }

  it("keeps emulator suggestions out of matching until atomic approval", async () => {
    const repo = repository();
    const game = await createIgdbGame();
    const contentValue = identifierValue("emulator");
    const payload = {
      emulatorId: "dosbox",
      contentKind: "program" as const,
      contentValue,
      gameId: game.id,
      installUuid: randomUUID(),
    };

    expect(await repo.suggestEmulatorContent(payload)).toEqual({
      status: "pending",
      game: undefined,
      reviewNote: undefined,
    });
    expect(await repo.suggestEmulatorContent(payload)).toMatchObject({
      status: "pending",
    });
    const beforeApproval = await repo.resolveEmulatorContent([
      { key: "test", ...payload },
    ]);
    expect(beforeApproval[0]).toMatchObject({
      confidence: "unknown",
      game: null,
    });
    expect(
      await pool.query(
        `SELECT count(*)::int AS count FROM emulator_content_submissions
         WHERE content_value = $1`,
        [contentValue.toLowerCase()],
      ),
    ).toMatchObject({ rows: [{ count: 1 }] });

    await pool.query(
      `WITH approved AS (
         UPDATE emulator_content_suggestions
         SET status = 'approved', reviewed_at = now(), updated_at = now()
         WHERE emulator_id = $1 AND content_kind = $2
           AND content_value = $3 AND game_id = $4 AND status = 'pending'
         RETURNING emulator_id, content_kind, content_value, game_id
       )
       INSERT INTO emulator_content_identifiers
         (emulator_id, content_kind, content_value, game_id, confidence)
       SELECT emulator_id, content_kind, content_value, game_id, 'curated'
       FROM approved
       ON CONFLICT (emulator_id, content_kind, content_value, game_id)
       DO UPDATE SET confidence = 'curated'`,
      ["dosbox", "program", contentValue.toLowerCase(), game.id],
    );

    expect(await repo.suggestEmulatorContent(payload)).toMatchObject({
      status: "already_curated",
      game: { id: game.id, name: game.name },
    });
    expect(
      await repo.resolveEmulatorContent([{ key: "test", ...payload }]),
    ).toMatchObject([{ confidence: "curated", game: { id: game.id } }]);
  });

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
    const pendingMatches = await repo.matchProcesses([
      {
        key: payload.exeName.toLowerCase(),
        identifiers: [
          { platform: "windows", kind: "exe", value: payload.exeName },
        ],
      },
    ]);
    expect(
      pendingMatches.get(payload.exeName.toLowerCase())?.pendingCommunityGames,
    ).toMatchObject([{ id: first.id, igdbId: payload.igdbId }]);
    expect(await repo.gamesByIds([first.id!])).toContainEqual(
      expect.objectContaining({
        id: first.id,
        source: "community",
        igdbId: payload.igdbId,
      }),
    );
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

  it("deduplicates mixed-case reports and keeps reviewed evidence immutable", async () => {
    const repo = repository();
    const exe = identifierValue("Report");
    const installUuid = randomUUID();
    const first = await repo.reportIdentifier({
      exeName: exe.toUpperCase(),
      reason: "not_a_game",
      installUuid,
    });
    const duplicate = await repo.reportIdentifier({
      exeName: exe.toLowerCase(),
      reason: "not_a_game",
      installUuid,
    });
    expect(first).toEqual({ status: "recorded", flagged: false });
    expect(duplicate).toEqual({ status: "duplicate", flagged: false });

    const stored = await pool.query<{
      value: string;
      reason: string;
      count: string;
    }>(
      `SELECT min(value) AS value, min(reason) AS reason, count(*)::text AS count
       FROM community_identifier_reports WHERE value = $1`,
      [exe.toLowerCase()],
    );
    expect(stored.rows[0]).toEqual({
      value: exe.toLowerCase(),
      reason: "not_a_game",
      count: "1",
    });

    await pool.query(
      `UPDATE community_identifier_reports
       SET status = 'verified', reviewed_at = now(), review_note = 'Reviewed'
       WHERE value = $1`,
      [exe.toLowerCase()],
    );
    await pool.query(
      `INSERT INTO problematic_game_identifiers
         (platform, kind, value, reason)
       VALUES ('windows', 'exe', $1, 'not_a_game')`,
      [exe.toLowerCase()],
    );
    const reviewed = await repo.reportIdentifier({
      exeName: exe,
      reason: "not_a_game",
      installUuid,
    });
    expect(reviewed).toEqual({ status: "already_reviewed", flagged: true });
    const unchanged = await pool.query<{
      reason: string;
      status: string;
      review_note: string;
    }>(
      `SELECT reason, status, review_note
       FROM community_identifier_reports WHERE value = $1`,
      [exe.toLowerCase()],
    );
    expect(unchanged.rows[0]).toEqual({
      reason: "not_a_game",
      status: "verified",
      review_note: "Reviewed",
    });
  });

  it("keeps system-ignore suggestions separate and install-deduplicated", async () => {
    const repo = repository();
    const exe = identifierValue("SharedIgnore");
    const installUuid = randomUUID();

    expect(
      await repo.reportIgnoredProcess({
        exeName: exe.toUpperCase(),
        platform: "windows",
        installUuid,
      }),
    ).toEqual({ status: "recorded" });
    expect(
      await repo.reportIgnoredProcess({
        exeName: exe.toLowerCase(),
        platform: "windows",
        installUuid,
      }),
    ).toEqual({ status: "duplicate" });
    await repo.reportIdentifier({
      exeName: exe,
      reason: "not_a_game",
      installUuid,
    });

    const counts = await pool.query<{
      ignore_count: string;
      wrong_match_count: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM community_ignored_process_reports
          WHERE value = $1) AS ignore_count,
         (SELECT count(*)::text FROM community_identifier_reports
          WHERE value = $1) AS wrong_match_count`,
      [exe.toLowerCase()],
    );
    expect(counts.rows[0]).toEqual({
      ignore_count: "1",
      wrong_match_count: "1",
    });

    await pool.query(
      `UPDATE community_ignored_process_reports
       SET status = 'verified', review_note = 'Reviewed' WHERE value = $1`,
      [exe.toLowerCase()],
    );
    expect(
      await repo.reportIgnoredProcess({
        exeName: exe,
        platform: "windows",
        installUuid,
      }),
    ).toEqual({ status: "already_reviewed" });
  });

  it("rejects patterns, paths, and unsupported platform-kind pairs", async () => {
    for (const [platform, kind, value] of [
      ["windows", "exe", "overlay*.exe"],
      ["windows", "exe", "folder/app.exe"],
      ["windows", "process_name", "service.exe"],
    ]) {
      await expect(
        pool.query(
          `INSERT INTO community_ignored_process_reports
             (platform, kind, value, install_uuid)
           VALUES ($1, $2, $3, $4)`,
          [platform, kind, value, randomUUID()],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    }
  });

  it("forces one stored IGDB candidate into the picker when flagged", async () => {
    const repo = repository();
    const exe = identifierValue("FlaggedStored");
    const game = await createIgdbGame();
    await pool.query(
      `INSERT INTO igdb_game_identifiers (platform, kind, value, game_id)
       VALUES ('windows', 'exe', $1, $2)`,
      [exe, game.id],
    );
    const request = [
      {
        key: exe.toLowerCase(),
        identifiers: [
          { platform: "windows" as const, kind: "exe" as const, value: exe },
        ],
      },
    ];
    expect(
      (await repo.matchProcesses(request)).get(exe.toLowerCase())?.game,
    ).toMatchObject({ id: game.id, source: "igdb" });

    await pool.query(
      `INSERT INTO problematic_game_identifiers
         (platform, kind, value, reason)
       VALUES ('windows', 'exe', $1, 'not_a_game')`,
      [exe.toLowerCase()],
    );
    const flagged = (await repo.matchProcesses(request)).get(exe.toLowerCase());
    expect(flagged).toMatchObject({
      game: null,
      flaggedIdentifier: { reason: "not_a_game" },
      ambiguousGames: [{ id: game.id, source: "igdb" }],
    });
  });

  it("keeps a verified community candidate selectable when flagged", async () => {
    const repo = repository();
    const exe = identifierValue("FlaggedCommunity");
    const gameId = await createGame();
    await pool.query(
      `INSERT INTO community_game_identifiers
         (platform, kind, value, game_id, verified, status)
       VALUES ('windows', 'exe', $1, $2, true, 'verified')`,
      [exe, gameId],
    );
    await pool.query(
      `INSERT INTO problematic_game_identifiers
         (platform, kind, value, reason)
       VALUES ('windows', 'exe', $1, 'ambiguous')`,
      [exe.toLowerCase()],
    );
    const match = (
      await repo.matchProcesses([
        {
          key: exe.toLowerCase(),
          identifiers: [
            {
              platform: "windows",
              kind: "exe",
              value: exe.toUpperCase(),
            },
          ],
        },
      ])
    ).get(exe.toLowerCase());
    expect(match).toMatchObject({
      game: null,
      flaggedIdentifier: { reason: "ambiguous" },
      ambiguousGames: [{ id: gameId, source: "community" }],
    });
    expect(
      (
        await pool.query(
          "SELECT 1 FROM community_game_identifiers WHERE game_id = $1",
          [gameId],
        )
      ).rowCount,
    ).toBe(1);
  });

  it("persists a flagged live IGDB hit only as an ambiguous candidate", async () => {
    const exe = identifierValue("FlaggedFallback");
    const igdbId = Math.floor(Math.random() * 1_000_000_000) + 1;
    class SingleMatchIgdb extends IgdbClient {
      constructor() {
        super({ clientId: "test", accessToken: "test" });
      }

      override async findWindowsGameByAlternativeName() {
        return {
          executableName: exe,
          game: { id: igdbId, name: "Flagged fallback game" },
        };
      }
    }
    const repo = repository(new SingleMatchIgdb());
    await pool.query(
      `INSERT INTO problematic_game_identifiers
         (platform, kind, value, reason)
       VALUES ('windows', 'exe', $1, 'not_a_game')`,
      [exe.toLowerCase()],
    );
    const match = (
      await repo.matchProcesses([
        {
          key: exe.toLowerCase(),
          identifiers: [{ platform: "windows", kind: "exe", value: exe }],
        },
      ])
    ).get(exe.toLowerCase());
    expect(match).toMatchObject({
      game: null,
      flaggedIdentifier: { reason: "not_a_game" },
      ambiguousGames: [
        { igdbId, name: "Flagged fallback game", source: "igdb" },
      ],
    });

    const stored = await pool.query<{
      id: number;
      normal_count: string;
      ambiguous_count: string;
    }>(
      `SELECT igdb_games.id,
              count(DISTINCT normal.game_id)::text AS normal_count,
              count(DISTINCT ambiguous.game_id)::text AS ambiguous_count
       FROM igdb_games
       LEFT JOIN igdb_game_identifiers normal
         ON normal.game_id = igdb_games.id AND lower(normal.value) = $2
       LEFT JOIN igdb_ambiguous_game_identifiers ambiguous
         ON ambiguous.game_id = igdb_games.id AND lower(ambiguous.value) = $2
       WHERE igdb_games.igdb_id = $1
       GROUP BY igdb_games.id`,
      [igdbId, exe.toLowerCase()],
    );
    igdbGameIds.push(stored.rows[0].id);
    expect(stored.rows[0]).toMatchObject({
      normal_count: "0",
      ambiguous_count: "1",
    });
  });
});
