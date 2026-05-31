import type {
  CommunityGameSuggestionPayload,
  CommunityGameSuggestionResponse,
  CommunityMetadataCandidate,
  FeedbackPayload,
  FeedbackResponse,
  Game,
  LiveEntry,
  MatchProcessRequestItem,
  ProcessIdentifier,
  ReportableGameSource,
} from "@playcounter/shared";
import pg from "pg";
import {
  createIgdbClientFromEnv,
  type IgdbGame,
  type IgdbClient,
  type IgdbExecutableMatch,
} from "./igdb.js";
import { count, logger } from "./logger.js";

type LiveSession = {
  installUuid: string;
  gameId: number;
  source: ReportableGameSource;
  lastPing: number;
};

type ProcessMatchResult = {
  game: Game | null;
  identifier?: ProcessIdentifier;
  ambiguousGames?: Game[];
  pendingCommunityGame?: Game;
};

const demoGames: Game[] = [
  {
    id: 1,
    name: "Cyberpunk 2077",
    coverUrl:
      "https://images.igdb.com/igdb/image/upload/t_cover_big/co2mjs.jpg",
    source: "igdb",
  },
  {
    id: 2,
    name: "Hades II",
    coverUrl:
      "https://images.igdb.com/igdb/image/upload/t_cover_big/co8t7a.jpg",
    source: "igdb",
  },
  {
    id: 3,
    name: "Balatro",
    coverUrl:
      "https://images.igdb.com/igdb/image/upload/t_cover_big/co8dko.jpg",
    source: "igdb",
  },
];

const exeMap = new Map<string, Game>([
  ["cyberpunk2077.exe", demoGames[0]],
  ["hades2.exe", demoGames[1]],
  ["balatro.exe", demoGames[2]],
]);

const identifierPriority: Record<string, number> = {
  "windows:exe": 10,
  "macos:bundle_id": 10,
  "linux:steam_app_id": 10,
  "macos:app_bundle": 20,
  "linux:wine_exe": 20,
  "linux:executable_path": 30,
  "macos:process_name": 40,
  "linux:desktop_id": 40,
  "linux:executable_name": 50,
};
const maxIgdbFallbacksPerMatchRequest = 5;

function liveSessionKey(
  installUuid: string,
  gameId: number,
  source: ReportableGameSource,
) {
  return `${installUuid}:${source}:${gameId}`;
}

export interface PlayCounterRepository {
  matchProcesses(
    processes: MatchProcessRequestItem[],
  ): Promise<Map<string, ProcessMatchResult>>;
  heartbeat(
    installUuid: string,
    gameId: number,
    source: ReportableGameSource,
  ): Promise<void>;
  endSession(
    installUuid: string,
    gameId: number,
    source: ReportableGameSource,
  ): Promise<void>;
  liveSnapshot(): Promise<LiveEntry[]>;
  statsToday(): Promise<LiveEntry[]>;
  statsWeek(): Promise<LiveEntry[]>;
  purgeStaleSessions(maxAgeMs: number): Promise<void>;
  gamesByIds(gameIds: number[]): Promise<Game[]>;
  searchIgdbGames(query: string): Promise<Game[]>;
  searchCommunityMetadata(query: string): Promise<CommunityMetadataCandidate[]>;
  suggestCommunityGame(
    suggestion: CommunityGameSuggestionPayload,
  ): Promise<CommunityGameSuggestionResponse>;
  createFeedback(payload: FeedbackPayload): Promise<FeedbackResponse>;
}

export class MemoryRepository implements PlayCounterRepository {
  private readonly live = new Map<string, LiveSession>();

  async matchProcesses(
    processes: MatchProcessRequestItem[],
  ): Promise<Map<string, ProcessMatchResult>> {
    const matches = new Map<
      string,
      { game: Game; identifier: ProcessIdentifier }
    >();
    for (const process of processes) {
      const ranked = process.identifiers
        .map((identifier) => ({
          identifier,
          game: exeMap.get(identifier.value.toLowerCase()),
          priority: processIdentifierPriority(identifier),
        }))
        .filter(
          (
            match,
          ): match is {
            identifier: ProcessIdentifier;
            game: Game;
            priority: number;
          } => Boolean(match.game),
        )
        .sort((left, right) => left.priority - right.priority);

      const best = ranked[0];
      if (best) matches.set(process.key, best);
    }
    return matches;
  }

  async heartbeat(
    installUuid: string,
    gameId: number,
    source: ReportableGameSource,
  ): Promise<void> {
    this.live.set(liveSessionKey(installUuid, gameId, source), {
      installUuid,
      gameId,
      source,
      lastPing: Date.now(),
    });
  }

  async endSession(
    installUuid: string,
    gameId: number,
    source: ReportableGameSource,
  ): Promise<void> {
    this.live.delete(liveSessionKey(installUuid, gameId, source));
  }

  async liveSnapshot(): Promise<LiveEntry[]> {
    const counts = new Map<
      string,
      { gameId: number; source: ReportableGameSource; playerCount: number }
    >();
    for (const session of this.live.values()) {
      const key = `${session.source}:${session.gameId}`;
      const existing = counts.get(key);
      counts.set(key, {
        gameId: session.gameId,
        source: session.source,
        playerCount: (existing?.playerCount ?? 0) + 1,
      });
    }

    return [...counts.values()]
      .map(({ gameId, source, playerCount }) => {
        const game = demoGames.find((candidate) => candidate.id === gameId);
        return {
          gameId,
          name: game?.name ?? `Game #${gameId}`,
          coverUrl: game?.coverUrl ?? "",
          source,
          playerCount,
        };
      })
      .sort((a, b) => b.playerCount - a.playerCount);
  }

  async statsToday(): Promise<LiveEntry[]> {
    return this.liveSnapshot();
  }

  async statsWeek(): Promise<LiveEntry[]> {
    return [
      {
        gameId: 1,
        name: "Cyberpunk 2077",
        coverUrl: demoGames[0].coverUrl,
        source: "igdb",
        playerCount: 142,
      },
      {
        gameId: 2,
        name: "Hades II",
        coverUrl: demoGames[1].coverUrl,
        source: "igdb",
        playerCount: 96,
      },
      {
        gameId: 3,
        name: "Balatro",
        coverUrl: demoGames[2].coverUrl,
        source: "igdb",
        playerCount: 71,
      },
    ];
  }

  async purgeStaleSessions(maxAgeMs: number): Promise<void> {
    const cutoff = Date.now() - maxAgeMs;
    for (const [installUuid, session] of this.live) {
      if (session.lastPing < cutoff) this.live.delete(installUuid);
    }
  }

  async gamesByIds(gameIds: number[]): Promise<Game[]> {
    return demoGames.filter((game) => gameIds.includes(game.id));
  }

  async searchIgdbGames(): Promise<Game[]> {
    return [];
  }

  async searchCommunityMetadata(): Promise<CommunityMetadataCandidate[]> {
    return [];
  }

  async suggestCommunityGame(): Promise<CommunityGameSuggestionResponse> {
    return { id: -1, verified: false };
  }

  async createFeedback(): Promise<FeedbackResponse> {
    return { id: -1 };
  }
}

export class PostgresRepository implements PlayCounterRepository {
  private readonly pool: pg.Pool;
  private readonly igdb: IgdbClient;

  constructor(connectionString: string, igdb = createIgdbClientFromEnv()) {
    this.pool = new pg.Pool({ connectionString });
    this.igdb = igdb;
  }

  async matchProcesses(
    processes: MatchProcessRequestItem[],
  ): Promise<Map<string, ProcessMatchResult>> {
    const candidates = flattenProcessIdentifiers(processes);
    if (candidates.length === 0) return new Map();

    logger.info(
      `[match] Matching ${count(processes.length, "process", "processes")} using ${count(candidates.length, "identifier")}.`,
    );

    const lookupKeys = candidates.map((candidate) => candidate.lookupKey);
    const matches = new Map<
      string,
      { game: Game; identifier: ProcessIdentifier; priority: number }
    >();
    const ambiguousMatches = new Map<string, Game[]>();
    const pendingCommunityMatches = new Map<string, Game>();

    const igdb = await this.pool.query(
      `SELECT lower(igdb_game_identifiers.platform) AS platform,
              lower(igdb_game_identifiers.kind) AS kind,
              lower(igdb_game_identifiers.value) AS value,
              igdb_games.id,
              igdb_games.name,
              igdb_games.cover_url
       FROM igdb_game_identifiers
       INNER JOIN igdb_games ON igdb_games.id = igdb_game_identifiers.game_id
       WHERE lower(igdb_game_identifiers.platform) || ':' ||
             lower(igdb_game_identifiers.kind) || ':' ||
             lower(igdb_game_identifiers.value) = ANY($1::text[])`,
      [lookupKeys],
    );

    logger.info(
      `[match] IGDB database returned ${count(igdb.rowCount ?? 0, "hit")}.`,
    );
    logAmbiguousProcessMatches("IGDB database", candidates, igdb.rows);

    for (const row of igdb.rows) {
      const game = {
        id: row.id,
        name: row.name,
        coverUrl: row.cover_url ?? "",
        source: "igdb" as const,
      };
      const lookupKey = `${row.platform}:${row.kind}:${row.value}`;
      for (const candidate of candidatesForLookup(candidates, lookupKey)) {
        setBestProcessMatch(matches, candidate, game);
      }
    }

    const unmatchedLookupKeys = candidates
      .filter((candidate) => !matches.has(candidate.processKey))
      .map((candidate) => candidate.lookupKey);
    if (unmatchedLookupKeys.length === 0) {
      logger.info(
        "[match] All processes resolved from the IGDB database; done.",
      );
      return stripProcessMatchPriority(matches);
    }

    const community = await this.pool.query(
      `SELECT lower(community_game_identifiers.platform) AS platform,
              lower(community_game_identifiers.kind) AS kind,
              lower(community_game_identifiers.value) AS value,
              community_games.id,
              community_games.name,
              community_games.cover_url
       FROM community_game_identifiers
       INNER JOIN community_games ON community_games.id = community_game_identifiers.game_id
       WHERE community_games.verified = true
         AND lower(community_game_identifiers.platform) || ':' ||
             lower(community_game_identifiers.kind) || ':' ||
             lower(community_game_identifiers.value) = ANY($1::text[])`,
      [[...new Set(unmatchedLookupKeys)]],
    );

    logger.info(
      `[match] Verified community database returned ${count(community.rowCount ?? 0, "hit")} for the ${count(new Set(unmatchedLookupKeys).size, "remaining identifier")}.`,
    );
    logAmbiguousProcessMatches(
      "community database",
      candidates,
      community.rows,
    );

    for (const row of community.rows) {
      const game = {
        id: row.id,
        name: row.name,
        coverUrl: row.cover_url ?? "",
        source: "community" as const,
      };
      const lookupKey = `${row.platform}:${row.kind}:${row.value}`;
      for (const candidate of candidatesForLookup(candidates, lookupKey)) {
        if (!matches.has(candidate.processKey)) {
          setBestProcessMatch(matches, candidate, game);
        }
      }
    }

    const pendingLookupKeys = candidates
      .filter((candidate) => !matches.has(candidate.processKey))
      .map((candidate) => candidate.lookupKey);
    if (pendingLookupKeys.length > 0) {
      const pendingCommunity = await this.pool.query(
        `SELECT lower(community_game_identifiers.platform) AS platform,
                lower(community_game_identifiers.kind) AS kind,
                lower(community_game_identifiers.value) AS value,
                community_games.id,
                community_games.name,
                community_games.cover_url
         FROM community_game_identifiers
         INNER JOIN community_games ON community_games.id = community_game_identifiers.game_id
         WHERE community_games.verified = false
           AND lower(community_game_identifiers.platform) || ':' ||
               lower(community_game_identifiers.kind) || ':' ||
               lower(community_game_identifiers.value) = ANY($1::text[])`,
        [[...new Set(pendingLookupKeys)]],
      );

      logger.info(
        `[match] Pending (unverified) community database returned ${count(pendingCommunity.rowCount ?? 0, "hit")} for the ${count(new Set(pendingLookupKeys).size, "still-unmatched identifier")}.`,
      );

      for (const row of pendingCommunity.rows) {
        const game = {
          id: row.id,
          name: row.name,
          coverUrl: row.cover_url ?? "",
          source: "community" as const,
        };
        const lookupKey = `${row.platform}:${row.kind}:${row.value}`;
        for (const candidate of candidatesForLookup(candidates, lookupKey)) {
          if (!matches.has(candidate.processKey)) {
            pendingCommunityMatches.set(candidate.processKey, game);
          }
        }
      }
    }

    const stillUnmatchedProcesses = new Set(
      candidates
        .filter((candidate) => !matches.has(candidate.processKey))
        .map((candidate) => candidate.processKey),
    );

    if (stillUnmatchedProcesses.size > 0) {
      const windowsExeCandidates = candidates.filter(
        (candidate) =>
          stillUnmatchedProcesses.has(candidate.processKey) &&
          candidate.identifier.platform === "windows" &&
          candidate.identifier.kind === "exe",
      );
      const checkedExeNames = new Set<string>();
      let igdbFallbackCount = 0;

      for (const candidate of windowsExeCandidates) {
        const exeName = candidate.identifier.value;
        if (checkedExeNames.has(candidate.normalizedValue)) continue;
        checkedExeNames.add(candidate.normalizedValue);
        if (igdbFallbackCount >= maxIgdbFallbacksPerMatchRequest) {
          logger.info(
            `[match] IGDB live-lookup limit (${maxIgdbFallbacksPerMatchRequest}) reached; skipping "${exeName}" until the next request.`,
          );
          continue;
        }
        igdbFallbackCount += 1;

        logger.info(
          `[match] No stored mapping for "${exeName}"; querying IGDB for a matching Windows alternative name.`,
        );
        const requestedBy = windowsExeCandidates
          .filter(
            (other) => other.normalizedValue === candidate.normalizedValue,
          )
          .map((other) => other.processKey);
        const result = await this.findAndPersistIgdbWindowsExe(
          candidate.identifier.value,
          requestedBy,
        );
        if (!result) {
          logger.info(
            `[match] IGDB had no exact Windows alternative name for "${exeName}"; leaving it unmatched.`,
          );
          continue;
        }

        if (result.ambiguousGames) {
          for (const matchingCandidate of windowsExeCandidates.filter(
            (other) => other.normalizedValue === candidate.normalizedValue,
          )) {
            ambiguousMatches.set(
              matchingCandidate.processKey,
              result.ambiguousGames,
            );
          }
          continue;
        }

        for (const matchingCandidate of windowsExeCandidates.filter(
          (other) => other.identifier.value === exeName,
        )) {
          if (!matches.has(matchingCandidate.processKey)) {
            setBestProcessMatch(matches, matchingCandidate, result.game);
          }
        }
      }
    }

    logger.info(
      `[match] Done: ${count(matches.size, "process", "processes")} matched, ${count(processes.length - matches.size, "process", "processes")} unmatched.`,
    );
    return stripProcessMatchPriority(
      matches,
      ambiguousMatches,
      pendingCommunityMatches,
    );
  }

  async heartbeat(
    installUuid: string,
    gameId: number,
    source: ReportableGameSource,
  ): Promise<void> {
    const result = await this.pool.query(
      `INSERT INTO live_sessions (install_uuid, game_id, game_source, last_ping)
       SELECT $1, $2, $3, now()
       WHERE EXISTS (
         SELECT 1 FROM igdb_games WHERE $3 = 'igdb' AND id = $2
         UNION ALL
         SELECT 1 FROM community_games WHERE $3 = 'community' AND id = $2
       )
       ON CONFLICT (install_uuid, game_source, game_id)
       DO UPDATE SET last_ping = now()`,
      [installUuid, gameId, source],
    );
    if (result.rowCount === 0) {
      logger.warn(
        `[heartbeat] Ignored heartbeat for unknown ${source} game ${gameId}.`,
      );
    }
  }

  async endSession(
    installUuid: string,
    gameId: number,
    source: ReportableGameSource,
  ): Promise<void> {
    await this.pool.query(
      "DELETE FROM live_sessions WHERE install_uuid = $1 AND game_id = $2 AND game_source = $3",
      [installUuid, gameId, source],
    );
  }

  async liveSnapshot(): Promise<LiveEntry[]> {
    const result = await this.pool.query(
      `SELECT live_sessions.game_id,
              live_sessions.game_source AS source,
              coalesce(igdb_games.name, community_games.name, 'Unknown Game') AS name,
              coalesce(igdb_games.cover_url, community_games.cover_url, '') AS cover_url,
              count(*)::int AS player_count
       FROM live_sessions
       LEFT JOIN igdb_games
         ON live_sessions.game_source = 'igdb'
        AND igdb_games.id = live_sessions.game_id
       LEFT JOIN community_games
         ON live_sessions.game_source = 'community'
        AND community_games.id = live_sessions.game_id
       GROUP BY live_sessions.game_id,
                live_sessions.game_source,
                coalesce(igdb_games.name, community_games.name, 'Unknown Game'),
                coalesce(igdb_games.cover_url, community_games.cover_url, '')
       ORDER BY player_count DESC`,
    );
    return result.rows.map((row) => ({
      gameId: row.game_id,
      name: row.name,
      coverUrl: row.cover_url,
      source: row.source,
      playerCount: row.player_count,
    }));
  }

  async statsToday(): Promise<LiveEntry[]> {
    return this.statsForInterval("1 day");
  }

  async statsWeek(): Promise<LiveEntry[]> {
    return this.statsForInterval("7 days");
  }

  async purgeStaleSessions(maxAgeMs: number): Promise<void> {
    await this.pool.query(
      "DELETE FROM live_sessions WHERE last_ping < now() - make_interval(secs => $1)",
      [Math.floor(maxAgeMs / 1000)],
    );
  }

  async gamesByIds(gameIds: number[]): Promise<Game[]> {
    if (gameIds.length === 0) return [];
    const result = await this.pool.query(
      `SELECT id, name, cover_url, 'igdb' AS source
       FROM igdb_games
       WHERE id = ANY($1::int[])
       UNION ALL
       SELECT id, name, cover_url, 'community' AS source
       FROM community_games
       WHERE id = ANY($1::int[])`,
      [[...new Set(gameIds)]],
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      coverUrl: row.cover_url ?? "",
      source: row.source,
    }));
  }

  async searchIgdbGames(query: string): Promise<Game[]> {
    if (!this.igdb.configured) return [];
    const games = await this.igdb.searchGames(query, 10);
    return this.persistIgdbGameMetadata(games);
  }

  async searchCommunityMetadata(
    query: string,
  ): Promise<CommunityMetadataCandidate[]> {
    if (!this.igdb.configured) return [];

    try {
      const games = await this.igdb.searchGames(query, 10);
      return games.map((game) => ({
        igdbId: game.id,
        name: game.name,
        coverUrl: game.cover?.image_id
          ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover.image_id}.jpg`
          : "",
        releaseYear: game.first_release_date
          ? new Date(game.first_release_date * 1000).getFullYear()
          : undefined,
      }));
    } catch (error) {
      logger.warn(
        `[search] IGDB metadata search failed for ${JSON.stringify(query)}: ${formatError(error)}`,
      );
      return [];
    }
  }

  async suggestCommunityGame(
    suggestion: CommunityGameSuggestionPayload,
  ): Promise<CommunityGameSuggestionResponse> {
    const exeName = suggestion.exeName.trim();
    const name = suggestion.name.trim();
    const coverUrl = suggestion.coverUrl?.trim() || null;
    const submittedBy = suggestion.installUuid ?? null;

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<{ id: number; verified: boolean }>(
        `SELECT community_games.id, community_games.verified
         FROM community_game_identifiers
         INNER JOIN community_games ON community_games.id = community_game_identifiers.game_id
         WHERE lower(community_game_identifiers.platform) = 'windows'
           AND lower(community_game_identifiers.kind) = 'exe'
           AND lower(community_game_identifiers.value) = lower($1)
           AND (
             community_games.verified = true
             OR community_games.submitted_by = $2
             OR community_games.verified = false
           )
         ORDER BY community_games.verified DESC,
                  CASE WHEN community_games.submitted_by = $2 THEN 0 ELSE 1 END,
                  community_games.created_at ASC
         LIMIT 1`,
        [exeName, submittedBy],
      );
      const existingGame = existing.rows[0];
      if (existingGame) {
        await client.query("COMMIT");
        logger.info(
          `[community] Reused existing ${existingGame.verified ? "verified" : "pending"} community game ${existingGame.id} for "${exeName}"; skipping duplicate suggestion.`,
        );
        return { id: existingGame.id, verified: existingGame.verified };
      }

      const gameResult = await client.query<{ id: number; verified: boolean }>(
        `INSERT INTO community_games (name, cover_url, submitted_by, verified)
         VALUES ($1, $2, $3, false)
         RETURNING id, verified`,
        [name, coverUrl, submittedBy],
      );
      const game = gameResult.rows[0];

      await client.query(
        `INSERT INTO community_game_identifiers (platform, kind, value, game_id)
         VALUES ('windows', 'exe', $1, $2)
         ON CONFLICT (lower(platform), lower(kind), lower(value))
         DO UPDATE SET value = excluded.value, game_id = excluded.game_id`,
        [exeName, game.id],
      );

      await client.query("COMMIT");
      logger.info(
        `[community] Recorded "${name}" for "${exeName}" as pending community game ${game.id}.`,
      );
      return { id: game.id, verified: game.verified };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createFeedback(payload: FeedbackPayload): Promise<FeedbackResponse> {
    const result = await this.pool.query<{ id: number }>(
      `INSERT INTO feedback (type, message, app_version, platform, install_uuid)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        payload.type,
        payload.message.trim(),
        payload.appVersion.trim() || null,
        payload.platform.trim() || null,
        payload.installUuid ?? null,
      ],
    );
    return { id: result.rows[0].id };
  }

  private async statsForInterval(interval: string): Promise<LiveEntry[]> {
    const result = await this.pool.query(
      `SELECT daily_stats.game_id,
              daily_stats.game_source AS source,
              coalesce(igdb_games.name, community_games.name, 'Unknown Game') AS name,
              coalesce(igdb_games.cover_url, community_games.cover_url, '') AS cover_url,
              max(daily_stats.player_count)::int AS player_count
       FROM daily_stats
       LEFT JOIN igdb_games
         ON daily_stats.game_source = 'igdb'
        AND igdb_games.id = daily_stats.game_id
       LEFT JOIN community_games
         ON daily_stats.game_source = 'community'
        AND community_games.id = daily_stats.game_id
       WHERE daily_stats.date >= (current_date - $1::interval)
       GROUP BY daily_stats.game_id,
                daily_stats.game_source,
                coalesce(igdb_games.name, community_games.name, 'Unknown Game'),
                coalesce(igdb_games.cover_url, community_games.cover_url, '')
       ORDER BY player_count DESC
       LIMIT 50`,
      [interval],
    );
    return result.rows.map((row) => ({
      gameId: row.game_id,
      name: row.name,
      coverUrl: row.cover_url,
      source: row.source,
      playerCount: row.player_count,
    }));
  }

  private async findAndPersistIgdbWindowsExe(
    exeName: string,
    requestedBy: string[],
  ) {
    if (!this.igdb.configured) {
      logger.info(
        `[match] IGDB live lookup skipped for "${exeName}"; credentials missing (set IGDB_CLIENT_ID/TWITCH_CLIENT_ID and IGDB_ACCESS_TOKEN/TWITCH_CLIENT_SECRET).`,
      );
      return null;
    }

    let igdbMatch: IgdbExecutableMatch | null;
    try {
      igdbMatch = await this.igdb.findWindowsGameByAlternativeName(
        exeName,
        requestedBy,
      );
    } catch (error) {
      logger.warn(
        `[match] IGDB live lookup failed for ${JSON.stringify(exeName)}: ${formatError(error)}`,
      );
      return null;
    }

    if (!igdbMatch) return null;

    if (igdbMatch.ambiguousGames) {
      return {
        ambiguousGames: await this.persistIgdbGameMetadata(
          igdbMatch.ambiguousGames,
        ),
      };
    }

    const { executableName, game: igdbGame } = igdbMatch;
    logger.info(
      `[match] IGDB matched "${executableName}" -> ${igdbGame.name} (IGDB #${igdbGame.id}); saving mapping.`,
    );

    const coverUrl = igdbGame.cover?.image_id
      ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${igdbGame.cover.image_id}.jpg`
      : null;

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ id: number }>(
        `INSERT INTO igdb_games (igdb_id, name, cover_url)
         VALUES ($1, $2, $3)
         ON CONFLICT (igdb_id)
         DO UPDATE SET name = excluded.name, cover_url = excluded.cover_url
         RETURNING id`,
        [igdbGame.id, igdbGame.name, coverUrl],
      );
      const dbGameId = result.rows[0].id;

      await client.query(
        `INSERT INTO igdb_game_identifiers (platform, kind, value, game_id)
         VALUES ('windows', 'exe', $1, $2)
         ON CONFLICT (lower(platform), lower(kind), lower(value))
         DO UPDATE SET value = excluded.value, game_id = excluded.game_id`,
        [executableName, dbGameId],
      );

      await client.query("COMMIT");
      logger.info(
        `[match] Saved "${executableName}" -> ${igdbGame.name} to the IGDB identifier database; future matches will be instant.`,
      );
      return { game: igdbGameToGame(dbGameId, igdbGame, coverUrl) };
    } catch (error) {
      await client.query("ROLLBACK");
      logger.warn(
        `[match] Failed to persist IGDB match for ${JSON.stringify(exeName)}: ${formatError(error)}`,
      );
      return null;
    } finally {
      client.release();
    }
  }

  private async persistIgdbGameMetadata(games: IgdbGame[]) {
    const persisted: Game[] = [];
    for (const game of games) {
      const coverUrl = game.cover?.image_id
        ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover.image_id}.jpg`
        : null;
      const result = await this.pool.query<{ id: number }>(
        `INSERT INTO igdb_games (igdb_id, name, cover_url)
         VALUES ($1, $2, $3)
         ON CONFLICT (igdb_id)
         DO UPDATE SET name = excluded.name, cover_url = excluded.cover_url
         RETURNING id`,
        [game.id, game.name, coverUrl],
      );
      persisted.push(igdbGameToGame(result.rows[0].id, game, coverUrl));
    }
    return persisted;
  }
}

type ProcessMatchCandidate = {
  processKey: string;
  lookupKey: string;
  normalizedValue: string;
  identifier: ProcessIdentifier;
  priority: number;
};

function flattenProcessIdentifiers(
  processes: MatchProcessRequestItem[],
): ProcessMatchCandidate[] {
  const candidates: ProcessMatchCandidate[] = [];
  const seen = new Set<string>();

  for (const process of processes) {
    for (const identifier of process.identifiers) {
      const value = identifier.value.trim();
      if (!value) continue;
      const normalizedValue = value.toLowerCase();
      const normalized = normalizeProcessIdentifier(identifier, value);

      const lookupKey = `${normalized.platform}:${normalized.kind}:${normalizedValue}`;
      const dedupeKey = `${process.key}:${lookupKey}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      candidates.push({
        processKey: process.key,
        lookupKey,
        normalizedValue,
        identifier: normalized,
        priority: processIdentifierPriority(normalized),
      });
    }
  }

  return candidates.sort((left, right) => left.priority - right.priority);
}

function normalizeProcessIdentifier(
  identifier: ProcessIdentifier,
  value: string,
): ProcessIdentifier {
  return {
    platform: identifier.platform,
    kind: identifier.kind,
    value,
  };
}

function processIdentifierPriority(identifier: ProcessIdentifier) {
  return identifierPriority[`${identifier.platform}:${identifier.kind}`] ?? 100;
}

function setBestProcessMatch(
  matches: Map<
    string,
    { game: Game; identifier: ProcessIdentifier; priority: number }
  >,
  candidate: ProcessMatchCandidate,
  game: Game,
) {
  const existing = matches.get(candidate.processKey);
  if (existing && existing.priority <= candidate.priority) return;
  matches.set(candidate.processKey, {
    game,
    identifier: candidate.identifier,
    priority: candidate.priority,
  });
}

function candidatesForLookup(
  candidates: ProcessMatchCandidate[],
  lookupKey: string,
) {
  return candidates.filter((candidate) => candidate.lookupKey === lookupKey);
}

function stripProcessMatchPriority(
  matches: Map<
    string,
    { game: Game; identifier: ProcessIdentifier; priority: number }
  >,
  ambiguousMatches = new Map<string, Game[]>(),
  pendingCommunityMatches = new Map<string, Game>(),
) {
  const results = new Map<string, ProcessMatchResult>();
  for (const [key, match] of matches) {
    results.set(key, { game: match.game, identifier: match.identifier });
  }
  for (const [key, ambiguousGames] of ambiguousMatches) {
    if (!results.has(key)) results.set(key, { game: null, ambiguousGames });
  }
  for (const [key, pendingCommunityGame] of pendingCommunityMatches) {
    if (!results.has(key)) {
      results.set(key, { game: null, pendingCommunityGame });
    }
  }
  return results;
}

function igdbGameToGame(
  dbGameId: number,
  game: IgdbGame,
  coverUrl?: string | null,
) {
  return {
    id: dbGameId,
    name: game.name,
    coverUrl:
      coverUrl ??
      (game.cover?.image_id
        ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover.image_id}.jpg`
        : ""),
    source: "igdb" as const,
  };
}

type DatabaseMatchRow = {
  platform: string;
  kind: string;
  value: string;
  id: number;
  name: string;
};

function logAmbiguousProcessMatches(
  source: string,
  candidates: ProcessMatchCandidate[],
  rows: DatabaseMatchRow[],
) {
  const gamesByLookup = new Map<string, Map<number, string>>();

  for (const row of rows) {
    const lookupKey = `${row.platform}:${row.kind}:${row.value}`;
    const games = gamesByLookup.get(lookupKey) ?? new Map<number, string>();
    games.set(row.id, row.name);
    gamesByLookup.set(lookupKey, games);
  }

  for (const [lookupKey, games] of gamesByLookup) {
    if (games.size <= 1) continue;

    const requestedBy = candidates
      .filter((candidate) => candidate.lookupKey === lookupKey)
      .map((candidate) => candidate.processKey);

    logger.warn(
      `[match] Ambiguous ${source} match: ${lookupKey} (requested by ${[
        ...new Set(requestedBy),
      ].join(", ")}) maps to ${count(games.size, "game")}: ${[...games]
        .map(([id, name]) => `${name} (#${id})`)
        .join(", ")}.`,
    );
  }
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function createRepository(): PlayCounterRepository {
  if (process.env.DATABASE_URL)
    return new PostgresRepository(process.env.DATABASE_URL);
  return new MemoryRepository();
}
