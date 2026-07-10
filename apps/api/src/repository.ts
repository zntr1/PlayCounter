import type {
  CommunityGameSuggestionPayload,
  CommunityGameSuggestionResponse,
  CommunityMetadataCandidate,
  FeedbackPayload,
  FeedbackResponse,
  Game,
  MatchProcessRequestItem,
  ProcessIdentifier,
} from "@playcounter/shared";
import pg from "pg";
import {
  createIgdbClientFromEnv,
  type IgdbGame,
  type IgdbClient,
  type IgdbExecutableMatch,
} from "./igdb.js";
import { count, logger } from "./logger.js";

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
// How long a failed IGDB live lookup is remembered. Clients poll match-processes
// continuously while an exe runs, and without this every poll from every client
// re-queries IGDB for the same known-unmatched executable.
const igdbLookupMissTtlMs = 6 * 60 * 60 * 1000;

export interface PlayCounterRepository {
  matchProcesses(
    processes: MatchProcessRequestItem[],
  ): Promise<Map<string, ProcessMatchResult>>;
  gamesByIds(gameIds: number[]): Promise<Game[]>;
  searchIgdbGames(query: string): Promise<Game[]>;
  searchCommunityMetadata(query: string): Promise<CommunityMetadataCandidate[]>;
  suggestCommunityGame(
    suggestion: CommunityGameSuggestionPayload,
  ): Promise<CommunityGameSuggestionResponse>;
  createFeedback(payload: FeedbackPayload): Promise<FeedbackResponse>;
}

export class MemoryRepository implements PlayCounterRepository {
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
  // In-memory cache for IGDB live lookups that found no match or an ambiguous
  // set, keyed by lowercased exe name. Lost on restart, which just costs one
  // extra lookup.
  private readonly igdbLookupCache = new Map<
    string,
    { at: number; ambiguousGames?: Game[] }
  >();

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

    // Verified community entries are always checked alongside the IGDB
    // database: a community entry for an exe that IGDB also maps is usually a
    // correction, so both candidates go to the picker instead of IGDB winning
    // silently.
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
      [[...new Set(lookupKeys)]],
    );

    logger.info(
      `[match] Verified community database returned ${count(community.rowCount ?? 0, "hit")}.`,
    );
    logAmbiguousProcessMatches(
      "community database",
      candidates,
      community.rows,
    );

    // Merge both sources per identifier; IGDB rows go first so they lead
    // ambiguous candidate lists. Entries sharing a name count as the same game.
    const storedGamesByLookup = new Map<string, Game[]>();
    const addStoredRows = (
      rows: (DatabaseMatchRow & { cover_url: string | null })[],
      source: "igdb" | "community",
    ) => {
      for (const row of rows) {
        const lookupKey = `${row.platform}:${row.kind}:${row.value}`;
        const games = storedGamesByLookup.get(lookupKey) ?? [];
        if (
          !games.some(
            (existing) =>
              existing.name.toLowerCase() === row.name.toLowerCase(),
          )
        ) {
          games.push({
            id: row.id,
            name: row.name,
            coverUrl: row.cover_url ?? "",
            source,
          });
        }
        storedGamesByLookup.set(lookupKey, games);
      }
    };
    addStoredRows(igdb.rows, "igdb");
    addStoredRows(community.rows, "community");

    for (const [lookupKey, games] of storedGamesByLookup) {
      for (const candidate of candidatesForLookup(candidates, lookupKey)) {
        if (games.length === 1) {
          setBestProcessMatch(matches, candidate, games[0]);
        } else if (!ambiguousMatches.has(candidate.processKey)) {
          ambiguousMatches.set(candidate.processKey, games);
        }
      }
    }

    const isUnresolved = (candidate: ProcessMatchCandidate) =>
      !matches.has(candidate.processKey) &&
      !ambiguousMatches.has(candidate.processKey);

    if (!candidates.some(isUnresolved)) {
      logger.info(
        "[match] All processes resolved from the stored databases; done.",
      );
      return stripProcessMatchPriority(matches, ambiguousMatches);
    }

    const pendingLookupKeys = candidates
      .filter(isUnresolved)
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
          if (isUnresolved(candidate)) {
            pendingCommunityMatches.set(candidate.processKey, game);
          }
        }
      }
    }

    const stillUnmatchedProcesses = new Set(
      candidates.filter(isUnresolved).map((candidate) => candidate.processKey),
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

    const cacheKey = exeName.toLowerCase();
    const cached = this.igdbLookupCache.get(cacheKey);
    if (cached !== undefined) {
      if (Date.now() - cached.at < igdbLookupMissTtlMs) {
        logger.info(
          `[match] IGDB live lookup skipped for "${exeName}"; a recent lookup found ${cached.ambiguousGames ? "the same ambiguous set" : "no match"}.`,
        );
        return cached.ambiguousGames
          ? { ambiguousGames: cached.ambiguousGames }
          : null;
      }
      this.igdbLookupCache.delete(cacheKey);
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

    if (!igdbMatch) {
      // Only genuine "no exact match" results are cached; lookup errors above
      // return early and stay retryable.
      this.igdbLookupCache.set(cacheKey, { at: Date.now() });
      return null;
    }

    if (igdbMatch.ambiguousGames) {
      const ambiguousGames = await this.persistIgdbGameMetadata(
        igdbMatch.ambiguousGames,
      );
      this.igdbLookupCache.set(cacheKey, { at: Date.now(), ambiguousGames });
      return { ambiguousGames };
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
