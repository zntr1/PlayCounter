import type {
  CommunityGameAlias,
  CommunityGameSuggestionPayload,
  CommunityGameSuggestionResponse,
  CommunityMetadataCandidate,
  ContributionsResponse,
  ContributionStatus,
  EmulatorResolveRequest,
  EmulatorResolveResponse,
  FeedbackPayload,
  FeedbackResponse,
  Game,
  IdentifierFlagReason,
  IdentifierReportPayload,
  IdentifierReportResponse,
  IgnoredProcessReportPayload,
  IgnoredProcessReportResponse,
  MatchProcessRequestItem,
  Platform,
  ProcessIdentifier,
  ProcessIdentifierKind,
} from "@playcounter/shared";
import pg from "pg";
import {
  createIgdbClientFromEnv,
  type IgdbGame,
  type IgdbGameSearchOptions,
  type IgdbClient,
  type IgdbExecutableMatch,
} from "./igdb.js";
import { count, logger } from "./logger.js";
import { emulatorResolverFor } from "./emulatorResolvers.js";

type ProcessMatchResult = {
  game: Game | null;
  identifier?: ProcessIdentifier;
  ambiguousGames?: Game[];
  flaggedIdentifier?: { reason: IdentifierFlagReason };
  pendingCommunityGame?: Game;
  pendingCommunityGames?: Game[];
  communityGameAliases?: CommunityGameAlias[];
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

const ignoredProcessKinds = {
  windows: "exe",
  macos: "process_name",
  linux: "executable_name",
} as const satisfies Record<Platform, ProcessIdentifierKind>;
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
  searchEmulatorGames(emulatorId: string, query: string): Promise<Game[]>;
  searchCommunityMetadata(
    query: string,
    limit?: number,
    offset?: number,
    options?: IgdbGameSearchOptions,
  ): Promise<CommunityMetadataCandidate[]>;
  resolveEmulatorContent(
    items: EmulatorResolveRequest["items"],
  ): Promise<EmulatorResolveResponse["results"]>;
  suggestCommunityGame(
    suggestion: CommunityGameSuggestionPayload,
  ): Promise<CommunityGameSuggestionResponse>;
  reportIdentifier(
    report: IdentifierReportPayload,
  ): Promise<IdentifierReportResponse>;
  reportIgnoredProcess(
    report: IgnoredProcessReportPayload,
  ): Promise<IgnoredProcessReportResponse>;
  listContributions(installUuid: string): Promise<ContributionsResponse>;
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

  async searchEmulatorGames(): Promise<Game[]> {
    return [];
  }

  async searchCommunityMetadata(): Promise<CommunityMetadataCandidate[]> {
    return [];
  }

  async resolveEmulatorContent(
    items: EmulatorResolveRequest["items"],
  ): Promise<EmulatorResolveResponse["results"]> {
    return items.map((item) => ({
      key: item.key,
      confidence: "unknown",
      game: null,
    }));
  }

  async suggestCommunityGame(): Promise<CommunityGameSuggestionResponse> {
    return { id: -1, verified: false };
  }

  async reportIdentifier(): Promise<IdentifierReportResponse> {
    return { status: "recorded", flagged: false };
  }

  async reportIgnoredProcess(): Promise<IgnoredProcessReportResponse> {
    return { status: "recorded" };
  }

  async listContributions(): Promise<ContributionsResponse> {
    return {
      items: [],
      counts: { suggested: 0, verified: 0, pending: 0, rejected: 0 },
    };
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
  private readonly emulatorLookupCache = new Map<
    string,
    {
      at: number;
      result: EmulatorResolveResponse["results"][number];
    }
  >();

  constructor(connectionString: string, igdb = createIgdbClientFromEnv()) {
    this.pool = new pg.Pool({ connectionString });
    this.igdb = igdb;
  }

  async close() {
    await this.pool.end();
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
    const flaggedProcesses = new Map<string, IdentifierFlagReason>();
    const pendingCommunityMatches = new Map<string, Game[]>();

    const igdb = await this.pool.query(
      `SELECT lower(igdb_game_identifiers.platform) AS platform,
              lower(igdb_game_identifiers.kind) AS kind,
              lower(igdb_game_identifiers.value) AS value,
              igdb_games.id,
              igdb_games.igdb_id,
              igdb_games.name,
              igdb_games.cover_url
       FROM igdb_game_identifiers
       INNER JOIN igdb_games ON igdb_games.id = igdb_game_identifiers.game_id
       WHERE lower(igdb_game_identifiers.platform) || ':' ||
             lower(igdb_game_identifiers.kind) || ':' ||
             lower(igdb_game_identifiers.value) = ANY($1::text[])`,
      [lookupKeys],
    );

    // Candidate sets from earlier ambiguous IGDB live lookups; they feed the
    // picker straight from the database instead of repeating the lookup.
    const igdbAmbiguous = await this.pool.query(
      `SELECT lower(igdb_ambiguous_game_identifiers.platform) AS platform,
              lower(igdb_ambiguous_game_identifiers.kind) AS kind,
              lower(igdb_ambiguous_game_identifiers.value) AS value,
              igdb_games.id,
              igdb_games.igdb_id,
              igdb_games.name,
              igdb_games.cover_url
       FROM igdb_ambiguous_game_identifiers
       INNER JOIN igdb_games ON igdb_games.id = igdb_ambiguous_game_identifiers.game_id
       WHERE lower(igdb_ambiguous_game_identifiers.platform) || ':' ||
             lower(igdb_ambiguous_game_identifiers.kind) || ':' ||
             lower(igdb_ambiguous_game_identifiers.value) = ANY($1::text[])`,
      [[...new Set(lookupKeys)]],
    );

    const problematic = await this.pool.query<{
      platform: string;
      kind: string;
      value: string;
      reason: IdentifierFlagReason;
    }>(
      `SELECT platform, kind, value, reason
       FROM problematic_game_identifiers
       WHERE platform || ':' || kind || ':' || value = ANY($1::text[])`,
      [[...new Set(lookupKeys)]],
    );
    const flaggedLookups = new Map<string, IdentifierFlagReason>(
      problematic.rows.map((row) => [
        `${row.platform}:${row.kind}:${row.value}`,
        row.reason,
      ]),
    );

    logger.info(
      `[match] IGDB database returned ${count(igdb.rowCount ?? 0, "hit")} plus ${count(igdbAmbiguous.rowCount ?? 0, "stored ambiguous candidate")}.`,
    );
    logAmbiguousProcessMatches("IGDB database", candidates, igdb.rows);

    // Verified community entries are always checked alongside the IGDB
    // database: a community entry for an exe that IGDB also maps is usually a
    // correction, so both candidates go to the picker instead of IGDB winning
    // silently. Verification is per identifier — a game can be reached through
    // several executables, and each of them is reviewed on its own.
    const community = await this.pool.query(
      `SELECT lower(community_game_identifiers.platform) AS platform,
              lower(community_game_identifiers.kind) AS kind,
              lower(community_game_identifiers.value) AS value,
              community_games.id,
              community_games.igdb_id,
              community_games.name,
              community_games.cover_url
       FROM community_game_identifiers
       INNER JOIN community_games ON community_games.id = community_game_identifiers.game_id
       WHERE community_game_identifiers.verified = true
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
            igdbId: row.igdb_id ?? undefined,
            name: row.name,
            coverUrl: row.cover_url ?? "",
            source,
          });
        }
        storedGamesByLookup.set(lookupKey, games);
      }
    };
    addStoredRows(igdb.rows, "igdb");
    addStoredRows(igdbAmbiguous.rows, "igdb");
    addStoredRows(community.rows, "community");

    for (const [lookupKey, games] of storedGamesByLookup) {
      const flagReason = flaggedLookups.get(lookupKey);
      for (const candidate of candidatesForLookup(candidates, lookupKey)) {
        if (!flagReason && games.length === 1) {
          setBestProcessMatch(matches, candidate, games[0]);
        } else if (!ambiguousMatches.has(candidate.processKey)) {
          ambiguousMatches.set(candidate.processKey, games);
          if (flagReason) {
            flaggedProcesses.set(candidate.processKey, flagReason);
          }
        }
      }
    }

    const isUnresolved = (candidate: ProcessMatchCandidate) =>
      !matches.has(candidate.processKey) &&
      !ambiguousMatches.has(candidate.processKey);

    // Pending suggestions are queried for every identifier, including ones
    // that already resolve to IGDB or another community game. Otherwise a
    // client cannot tell that its pending suggestion was rejected: the other
    // match masks the absence of the pending row indefinitely.
    if (lookupKeys.length > 0) {
      const pendingCommunity = await this.pool.query(
        `SELECT lower(community_game_identifiers.platform) AS platform,
                lower(community_game_identifiers.kind) AS kind,
                lower(community_game_identifiers.value) AS value,
                community_games.id,
                community_games.igdb_id,
                community_games.name,
                community_games.cover_url
         FROM community_game_identifiers
         INNER JOIN community_games ON community_games.id = community_game_identifiers.game_id
         WHERE community_game_identifiers.verified = false
           AND community_game_identifiers.status <> 'rejected'
           AND lower(community_game_identifiers.platform) || ':' ||
               lower(community_game_identifiers.kind) || ':' ||
               lower(community_game_identifiers.value) = ANY($1::text[])`,
        [[...new Set(lookupKeys)]],
      );

      logger.info(
        `[match] Pending (unverified) community database returned ${count(pendingCommunity.rowCount ?? 0, "hit")} for ${count(new Set(lookupKeys).size, "identifier")}.`,
      );

      for (const row of pendingCommunity.rows) {
        const game = {
          id: row.id,
          igdbId: row.igdb_id ?? undefined,
          name: row.name,
          coverUrl: row.cover_url ?? "",
          source: "community" as const,
        };
        const lookupKey = `${row.platform}:${row.kind}:${row.value}`;
        for (const candidate of candidatesForLookup(candidates, lookupKey)) {
          const games = pendingCommunityMatches.get(candidate.processKey) ?? [];
          if (!games.some((existing) => existing.id === game.id)) {
            games.push(game);
          }
          pendingCommunityMatches.set(candidate.processKey, games);
        }
      }
    }

    if (!candidates.some(isUnresolved)) {
      logger.info(
        "[match] All processes resolved from the stored databases; done.",
      );
      return this.attachCommunityGameAliases(
        stripProcessMatchPriority(
          matches,
          ambiguousMatches,
          pendingCommunityMatches,
          flaggedProcesses,
        ),
      );
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
          flaggedLookups.has(candidate.lookupKey),
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
            const fallbackFlag = flaggedLookups.get(
              matchingCandidate.lookupKey,
            );
            if (fallbackFlag) {
              flaggedProcesses.set(matchingCandidate.processKey, fallbackFlag);
            }
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
    return this.attachCommunityGameAliases(
      stripProcessMatchPriority(
        matches,
        ambiguousMatches,
        pendingCommunityMatches,
        flaggedProcesses,
      ),
    );
  }

  // Tells the client which retired community ids belong to the games named in
  // a result. A client that still holds one of those ids — as a cached match,
  // or as the id of its own pending suggestion — can then move to the
  // surviving game, without guessing from the name, which two games can share.
  //
  // Every community game in the result is covered, not just the match: an exe
  // that both IGDB and the community map goes to the picker on purpose, so a
  // merged game frequently appears only among the candidates.
  private async attachCommunityGameAliases(
    results: Map<string, ProcessMatchResult>,
  ) {
    const communityGamesIn = (result: ProcessMatchResult) =>
      [
        result.game,
        result.pendingCommunityGame,
        ...(result.pendingCommunityGames ?? []),
        ...(result.ambiguousGames ?? []),
      ].filter((game): game is Game => game?.source === "community");

    const communityGameIds = [
      ...new Set(
        [...results.values()].flatMap((result) =>
          communityGamesIn(result).map((game) => game.id),
        ),
      ),
    ];
    if (communityGameIds.length === 0) return results;

    const aliases = await this.pool.query<{
      old_game_id: number;
      game_id: number;
    }>(
      `SELECT old_game_id, game_id FROM community_game_aliases
       WHERE game_id = ANY($1::int[])`,
      [communityGameIds],
    );
    if (aliases.rowCount === 0) return results;

    const retiredIdsByGame = new Map<number, number[]>();
    for (const row of aliases.rows) {
      const retired = retiredIdsByGame.get(row.game_id) ?? [];
      retired.push(row.old_game_id);
      retiredIdsByGame.set(row.game_id, retired);
    }

    for (const result of results.values()) {
      const gameAliases = [
        ...new Set(communityGamesIn(result).map((game) => game.id)),
      ]
        .map((gameId) => ({
          gameId,
          mergedFromGameIds: retiredIdsByGame.get(gameId) ?? [],
        }))
        .filter((alias) => alias.mergedFromGameIds.length > 0);
      if (gameAliases.length > 0) result.communityGameAliases = gameAliases;
    }

    return results;
  }

  async gamesByIds(gameIds: number[]): Promise<Game[]> {
    if (gameIds.length === 0) return [];
    const result = await this.pool.query(
      `SELECT id, igdb_id, name, cover_url, 'igdb' AS source
       FROM igdb_games
       WHERE id = ANY($1::int[])
       UNION ALL
       SELECT id, igdb_id, name, cover_url, 'community' AS source
       FROM community_games
       WHERE id = ANY($1::int[])
       UNION ALL
       -- Community ids that were merged into another entry still sit in older
       -- clients' caches and history. Serve the metadata of the game they were
       -- merged into, under the id that was asked for, so those cards keep
       -- their name and cover until the executable is matched again.
       SELECT aliases.old_game_id AS id,
              community_games.igdb_id,
              community_games.name,
              community_games.cover_url,
              'community' AS source
       FROM community_game_aliases aliases
       INNER JOIN community_games ON community_games.id = aliases.game_id
       WHERE aliases.old_game_id = ANY($1::int[])`,
      [[...new Set(gameIds)]],
    );
    return result.rows.map((row) => ({
      id: row.id,
      igdbId: row.igdb_id ?? undefined,
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

  async searchEmulatorGames(
    emulatorId: string,
    query: string,
  ): Promise<Game[]> {
    const definition = emulatorResolverFor(emulatorId);
    if (!this.igdb.configured || !definition) return [];
    const normalizedQuery = normalizeIgdbTitle(query);
    const games = await this.igdb.findGamesForPlatforms(
      query,
      definition.igdbPlatformIds,
      50,
    );
    games.sort((left, right) => {
      const exactRank = (game: IgdbGame) =>
        [game.name, ...(game.alternative_names ?? []).map((name) => name.name)]
          .filter((name): name is string => Boolean(name))
          .some((name) => normalizeIgdbTitle(name) === normalizedQuery)
          ? 0
          : 1;
      return exactRank(left) - exactRank(right);
    });
    return this.persistIgdbGameMetadata(games);
  }

  async searchCommunityMetadata(
    query: string,
    limit = 10,
    offset = 0,
    options: IgdbGameSearchOptions = {},
  ): Promise<CommunityMetadataCandidate[]> {
    if (!this.igdb.configured) return [];

    try {
      const games = await this.igdb.searchGames(query, limit, offset, options);
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

  async resolveEmulatorContent(
    items: EmulatorResolveRequest["items"],
  ): Promise<EmulatorResolveResponse["results"]> {
    if (items.length === 0) return [];

    type EmulatorIdentifierRow = {
      emulator_id: string;
      content_kind: string;
      content_value: string;
      confidence: "curated" | "candidate";
      id: number;
      igdb_id: number | null;
      name: string;
      cover_url: string | null;
    };

    const lookupKeys = [
      ...new Set(items.map((item) => emulatorContentLookupKey(item))),
    ];
    const stored = await this.pool.query<EmulatorIdentifierRow>(
      `SELECT lower(identifiers.emulator_id) AS emulator_id,
              lower(identifiers.content_kind) AS content_kind,
              lower(identifiers.content_value) AS content_value,
              identifiers.confidence,
              games.id,
              games.igdb_id,
              games.name,
              games.cover_url
       FROM emulator_content_identifiers identifiers
       INNER JOIN igdb_games games ON games.id = identifiers.game_id
       WHERE lower(identifiers.emulator_id) || ':' ||
             lower(identifiers.content_kind) || ':' ||
             lower(identifiers.content_value) = ANY($1::text[])`,
      [lookupKeys],
    );
    const rowsByLookup = new Map<string, EmulatorIdentifierRow[]>();
    for (const row of stored.rows) {
      const key = `${row.emulator_id}:${row.content_kind}:${row.content_value}`;
      const rows = rowsByLookup.get(key) ?? [];
      rows.push(row);
      rowsByLookup.set(key, rows);
    }

    type Resolution = Omit<EmulatorResolveResponse["results"][number], "key">;
    const resolutions = new Map<string, Resolution>();
    const uniqueItems = new Map(
      items.map((item) => [emulatorContentLookupKey(item), item]),
    );
    const missing: Array<EmulatorResolveRequest["items"][number]> = [];

    for (const [lookupKey, item] of uniqueItems) {
      const rows = rowsByLookup.get(lookupKey) ?? [];
      const curated = rows.find((row) => row.confidence === "curated");
      if (curated) {
        resolutions.set(lookupKey, {
          confidence: "curated",
          game: emulatorRowToGame(curated),
        });
        continue;
      }
      const candidates = dedupeGamesByIdentity(
        rows.map((row) => emulatorRowToGame(row)),
      );
      if (candidates.length > 0) {
        resolutions.set(
          lookupKey,
          candidates.length === 1
            ? { confidence: "probable", game: candidates[0] }
            : { confidence: "ambiguous", game: null, candidates },
        );
        continue;
      }
      missing.push(item);
    }

    let fallbackCount = 0;
    for (const item of missing) {
      const lookupKey = emulatorContentLookupKey(item);
      const definition = emulatorResolverFor(item.emulatorId);
      const cached = this.emulatorLookupCache.get(lookupKey);
      if (cached && Date.now() - cached.at < igdbLookupMissTtlMs) {
        const { key: _cachedKey, ...result } = cached.result;
        resolutions.set(lookupKey, result);
        continue;
      }
      if (
        !this.igdb.configured ||
        !definition ||
        fallbackCount >= maxIgdbFallbacksPerMatchRequest
      ) {
        resolutions.set(lookupKey, { confidence: "unknown", game: null });
        continue;
      }

      fallbackCount += 1;
      const query = definition.deriveSearchQuery(
        item.contentValue,
        item.searchHint,
      );
      if (!query) {
        resolutions.set(lookupKey, { confidence: "unknown", game: null });
        continue;
      }

      try {
        const found = dedupeIgdbGamesByIdentity(
          await this.igdb.findGamesForPlatforms(
            query,
            definition.igdbPlatformIds,
          ),
        );
        if (found.length === 0) {
          const result: EmulatorResolveResponse["results"][number] = {
            key: item.key,
            confidence: "unknown",
            game: null,
          };
          resolutions.set(lookupKey, result);
          this.emulatorLookupCache.set(lookupKey, { at: Date.now(), result });
          continue;
        }

        const normalizedQuery = normalizeIgdbTitle(query);
        const exact = found.filter((game) =>
          [
            game.name,
            ...(game.alternative_names ?? []).map((name) => name.name),
          ]
            .filter((name): name is string => Boolean(name))
            .some((name) => normalizeIgdbTitle(name) === normalizedQuery),
        );
        const selected = exact.length > 0 ? exact : found.slice(0, 20);
        const games = dedupeGamesByIdentity(
          await this.persistIgdbGameMetadata(selected),
        );

        let resolution: Resolution;
        if (exact.length === 1) {
          await this.persistEmulatorCandidates(item, games);
          resolution = { confidence: "probable", game: games[0] };
        } else if (exact.length > 1) {
          await this.persistEmulatorCandidates(item, games);
          resolution = {
            confidence: "ambiguous",
            game: null,
            candidates: games,
          };
        } else {
          resolution = {
            confidence: "ambiguous",
            game: null,
            candidates: games,
          };
          this.emulatorLookupCache.set(lookupKey, {
            at: Date.now(),
            result: { key: item.key, ...resolution },
          });
        }
        resolutions.set(lookupKey, resolution);
      } catch (error) {
        logger.warn(
          `[emulator] IGDB lookup failed for ${item.emulatorId}:${item.contentKind}:${JSON.stringify(item.contentValue)}: ${formatError(error)}`,
        );
        resolutions.set(lookupKey, { confidence: "unknown", game: null });
      }
    }

    return items.map((item) => ({
      key: item.key,
      ...(resolutions.get(emulatorContentLookupKey(item)) ?? {
        confidence: "unknown" as const,
        game: null,
      }),
    }));
  }

  async suggestCommunityGame(
    suggestion: CommunityGameSuggestionPayload,
  ): Promise<CommunityGameSuggestionResponse> {
    const exeName = suggestion.exeName.trim();
    const name = suggestion.name.trim();
    const coverUrl = suggestion.coverUrl?.trim() || null;
    const igdbId = suggestion.igdbId ?? null;
    const submittedBy = suggestion.installUuid ?? null;

    // If IGDB already maps this exe to the suggested game (directly or as an
    // ambiguous candidate), there is nothing to review — tell the client to
    // apply the IGDB match instead of filing a redundant suggestion.
    const knownIgdb = await this.pool.query<{
      id: number;
      igdb_id: number | null;
      name: string;
      cover_url: string | null;
    }>(
      `SELECT igdb_games.id, igdb_games.igdb_id, igdb_games.name, igdb_games.cover_url
       FROM (
         SELECT game_id FROM igdb_game_identifiers
         WHERE lower(platform) = 'windows'
           AND lower(kind) = 'exe'
           AND lower(value) = lower($1)
         UNION ALL
         SELECT game_id FROM igdb_ambiguous_game_identifiers
         WHERE lower(platform) = 'windows'
           AND lower(kind) = 'exe'
           AND lower(value) = lower($1)
       ) identifiers
       INNER JOIN igdb_games ON igdb_games.id = identifiers.game_id
       WHERE ($3::int IS NOT NULL AND igdb_games.igdb_id = $3::int)
          OR ($3::int IS NULL AND lower(igdb_games.name) = lower($2))
       LIMIT 1`,
      [exeName, name, igdbId],
    );
    const knownIgdbGame = knownIgdb.rows[0];
    if (knownIgdbGame) {
      logger.info(
        `[community] Suggestion "${name}" for "${exeName}" is already a known IGDB match (#${knownIgdbGame.id}); returning it instead of filing a suggestion.`,
      );
      return {
        igdbGame: {
          id: knownIgdbGame.id,
          igdbId: knownIgdbGame.igdb_id ?? undefined,
          name: knownIgdbGame.name,
          coverUrl: knownIgdbGame.cover_url ?? "",
          source: "igdb",
        },
      };
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      type IdentifierReviewRow = {
        platform: string;
        kind: string;
        value: string;
        game_id: number;
        verified: boolean;
        status: ContributionStatus;
        review_note: string | null;
      };
      const recordSubmission = async (identifier: IdentifierReviewRow) => {
        if (!submittedBy) return;
        await client.query(
          `INSERT INTO community_identifier_submissions
             (platform, kind, value, game_id, install_uuid)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT DO NOTHING`,
          [
            identifier.platform,
            identifier.kind,
            identifier.value,
            identifier.game_id,
            submittedBy,
          ],
        );
      };
      // Two clients can suggest the same new game at the same moment; both
      // would find nothing and insert their own row. Serialize per game so the
      // second one sees the first one's entry. Both keys are taken, always in
      // the same order: a client that sends no igdb id races against one that
      // does, and only the name connects those two.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `community-game-name:${name.toLowerCase()}`,
      ]);
      if (igdbId !== null) {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `community-game-igdb:${igdbId}`,
        ]);
      }

      // Which game this suggestion belongs to is decided once, here, and every
      // step below works off that id — the identity rule must not be repeated
      // in several queries that could disagree.
      //
      // The picked IGDB metadata is the identity. Name and cover art together
      // are the fallback: two games can share a title, but not a title and an
      // IGDB cover image. It carries suggestions from clients released before
      // igdb ids were sent, and lets a suggestion that has one adopt a row
      // that predates them — but never a row already identified as a
      // different game.
      const knownGame = await client.query<{
        id: number;
        igdb_id: number | null;
      }>(
        `SELECT id, igdb_id FROM community_games
         WHERE ($1::int IS NOT NULL AND igdb_id = $1::int)
            OR (
              lower(name) = lower($2)
              AND ($3::text IS NOT NULL AND cover_url = $3::text)
              AND ($1::int IS NULL OR igdb_id IS NULL)
            )
         ORDER BY ($1::int IS NOT NULL AND igdb_id = $1::int) DESC, id ASC
         LIMIT 1`,
        [igdbId, name, coverUrl],
      );
      let gameId = knownGame.rows[0]?.id;
      const reusedGame = gameId !== undefined;

      if (gameId === undefined) {
        // The unique index on igdb_id makes this the atomic point of truth:
        // a racing insert of the same game resolves to that game's row.
        const gameResult = await client.query<{ id: number }>(
          `INSERT INTO community_games (name, cover_url, submitted_by, verified, igdb_id)
           VALUES ($1, $2, $3, false, $4)
           ON CONFLICT (igdb_id) WHERE igdb_id IS NOT NULL
           DO UPDATE SET igdb_id = excluded.igdb_id
           RETURNING id`,
          [name, coverUrl, submittedBy, igdbId],
        );
        gameId = gameResult.rows[0].id;
      } else if (igdbId !== null && knownGame.rows[0].igdb_id === null) {
        // Matched a legacy row by name and cover: give it that identity so
        // later suggestions no longer depend on the name at all.
        await client.query(
          `UPDATE community_games SET igdb_id = $2
           WHERE id = $1 AND igdb_id IS NULL`,
          [gameId, igdbId],
        );
      }

      // This exact exe was already suggested for this game; report its own
      // review state back. Verification is per identifier, so a verified game
      // says nothing about a newly added exe.
      const existing = await client.query<IdentifierReviewRow>(
        `SELECT platform, kind, value, game_id, verified, status, review_note
         FROM community_game_identifiers
         WHERE lower(platform) = 'windows'
           AND lower(kind) = 'exe'
           AND lower(value) = lower($1)
           AND game_id = $2
         LIMIT 1`,
        [exeName, gameId],
      );
      const existingIdentifier = existing.rows[0];
      if (existingIdentifier) {
        await recordSubmission(existingIdentifier);
        await client.query("COMMIT");
        logger.info(
          `[community] "${exeName}" is already ${existingIdentifier.status} for community game ${gameId}; skipping duplicate suggestion.`,
        );
        return {
          id: gameId,
          verified: existingIdentifier.verified,
          ...(existingIdentifier.status === "rejected"
            ? {
                rejected: true,
                reviewNote: existingIdentifier.review_note ?? undefined,
              }
            : {}),
        };
      }

      // The new identifier always starts unverified, even on a game that is
      // already live — otherwise any exe could be published without review.
      const inserted = await client.query<IdentifierReviewRow>(
        `INSERT INTO community_game_identifiers
           (platform, kind, value, game_id, verified, status)
         VALUES ('windows', 'exe', $1, $2, false, 'pending')
         ON CONFLICT (lower(platform), lower(kind), lower(value), game_id)
         DO UPDATE SET platform = community_game_identifiers.platform
         RETURNING platform, kind, value, game_id, verified, status, review_note`,
        [exeName, gameId],
      );
      const identifier = inserted.rows[0];
      await recordSubmission(identifier);

      await client.query("COMMIT");
      logger.info(
        reusedGame
          ? `[community] Added "${exeName}" as a pending identifier of existing community game ${gameId} ("${name}").`
          : `[community] Recorded "${name}" for "${exeName}" as pending community game ${gameId}.`,
      );
      return {
        id: gameId,
        verified: identifier.verified,
        ...(identifier.status === "rejected"
          ? {
              rejected: true,
              reviewNote: identifier.review_note ?? undefined,
            }
          : {}),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async reportIdentifier(
    report: IdentifierReportPayload,
  ): Promise<IdentifierReportResponse> {
    const exeName = report.exeName.trim().toLowerCase();
    const upserted = await this.pool.query<{ inserted: boolean }>(
      `INSERT INTO community_identifier_reports
         (platform, kind, value, game_id, game_source, reason, install_uuid)
       VALUES ('windows', 'exe', $1, $2, $3, $4, $5)
       ON CONFLICT ON CONSTRAINT identifier_report_install_unique
       DO UPDATE SET reason = excluded.reason,
                     game_id = excluded.game_id,
                     game_source = excluded.game_source,
                     updated_at = now()
       WHERE community_identifier_reports.status = 'pending'
       RETURNING (xmax = 0) AS inserted`,
      [
        exeName,
        report.gameId ?? null,
        report.gameSource ?? null,
        report.reason,
        report.installUuid,
      ],
    );
    const flagged = await this.pool.query(
      `SELECT 1 FROM problematic_game_identifiers
       WHERE platform = 'windows' AND kind = 'exe' AND value = $1`,
      [exeName],
    );
    const row = upserted.rows[0];
    return {
      status:
        row === undefined
          ? "already_reviewed"
          : row.inserted
            ? "recorded"
            : "duplicate",
      flagged: (flagged.rowCount ?? 0) > 0,
    };
  }

  async reportIgnoredProcess(
    report: IgnoredProcessReportPayload,
  ): Promise<IgnoredProcessReportResponse> {
    const platform = report.platform;
    const kind = ignoredProcessKinds[platform];
    const value = report.exeName.trim().toLowerCase();
    const upserted = await this.pool.query<{ inserted: boolean }>(
      `INSERT INTO community_ignored_process_reports
         (platform, kind, value, install_uuid)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ON CONSTRAINT ignored_report_install_unique
       DO UPDATE SET updated_at = now()
       WHERE community_ignored_process_reports.status = 'pending'
       RETURNING (xmax = 0) AS inserted`,
      [platform, kind, value, report.installUuid],
    );
    const row = upserted.rows[0];
    return {
      status:
        row === undefined
          ? "already_reviewed"
          : row.inserted
            ? "recorded"
            : "duplicate",
    };
  }

  async listContributions(installUuid: string): Promise<ContributionsResponse> {
    const result = await this.pool.query<{
      platform: string;
      kind: string;
      value: string;
      game_id: number;
      game_name: string;
      cover_url: string | null;
      status: ContributionStatus;
      review_note: string | null;
      reviewed_at: Date | null;
      created_at: Date;
    }>(
      `SELECT submissions.platform,
              submissions.kind,
              submissions.value,
              submissions.game_id,
              games.name AS game_name,
              games.cover_url,
              identifiers.status,
              identifiers.review_note,
              identifiers.reviewed_at,
              submissions.created_at
       FROM community_identifier_submissions submissions
       INNER JOIN community_game_identifiers identifiers
         ON identifiers.platform = submissions.platform
        AND identifiers.kind = submissions.kind
        AND identifiers.value = submissions.value
        AND identifiers.game_id = submissions.game_id
       INNER JOIN community_games games ON games.id = submissions.game_id
       WHERE submissions.install_uuid = $1
       ORDER BY submissions.created_at DESC, submissions.id DESC`,
      [installUuid],
    );

    const counts = {
      suggested: result.rows.length,
      verified: 0,
      pending: 0,
      rejected: 0,
    };
    for (const row of result.rows) counts[row.status] += 1;

    return {
      items: result.rows.map((row) => ({
        platform: row.platform as "windows" | "macos" | "linux",
        kind: row.kind as
          | "exe"
          | "bundle_id"
          | "app_bundle"
          | "process_name"
          | "steam_app_id"
          | "executable_path"
          | "executable_name"
          | "desktop_id"
          | "wine_exe",
        value: row.value,
        gameId: row.game_id,
        gameName: row.game_name,
        coverUrl: row.cover_url ?? "",
        status: row.status,
        reviewNote: row.review_note ?? undefined,
        reviewedAt: row.reviewed_at?.toISOString(),
        createdAt: row.created_at.toISOString(),
      })),
      counts,
    };
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
    flagged = false,
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

    if (igdbMatch.ambiguousGames || flagged) {
      const ambiguousGames = await this.persistIgdbGameMetadata(
        igdbMatch.ambiguousGames ?? [igdbMatch.game],
      );
      // Persist the candidate set so future requests resolve it from the
      // stored-database merge instead of repeating this lookup. A verified
      // problematic identifier takes this path even for one exact IGDB game;
      // it must never recreate a high-confidence one-to-one mapping.
      for (const game of ambiguousGames) {
        await this.pool.query(
          `INSERT INTO igdb_ambiguous_game_identifiers (platform, kind, value, game_id)
           VALUES ('windows', 'exe', $1, $2)
           ON CONFLICT DO NOTHING`,
          [cacheKey, game.id],
        );
      }
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

  private async persistEmulatorCandidates(
    item: EmulatorResolveRequest["items"][number],
    games: Game[],
  ) {
    for (const game of games) {
      await this.pool.query(
        `INSERT INTO emulator_content_identifiers
           (emulator_id, content_kind, content_value, game_id, confidence)
         VALUES ($1, $2, $3, $4, 'candidate')
         ON CONFLICT DO NOTHING`,
        [
          item.emulatorId.toLowerCase(),
          item.contentKind.toLowerCase(),
          item.contentValue.toLowerCase(),
          game.id,
        ],
      );
    }
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
  pendingCommunityMatches = new Map<string, Game[]>(),
  flaggedProcesses = new Map<string, IdentifierFlagReason>(),
) {
  const results = new Map<string, ProcessMatchResult>();
  for (const [key, match] of matches) {
    results.set(key, { game: match.game, identifier: match.identifier });
  }
  for (const [key, ambiguousGames] of ambiguousMatches) {
    if (!results.has(key)) {
      const flagReason = flaggedProcesses.get(key);
      results.set(key, {
        game: null,
        ambiguousGames,
        ...(flagReason ? { flaggedIdentifier: { reason: flagReason } } : {}),
      });
    }
  }
  for (const [key, pendingCommunityGames] of pendingCommunityMatches) {
    const existing: ProcessMatchResult = results.get(key) ?? { game: null };
    const hasResolvedMatch =
      existing.game !== null || Boolean(existing.ambiguousGames?.length);
    results.set(key, {
      ...existing,
      // Keep the legacy singular field exclusive to unresolved results. Older
      // desktops prioritize it over a normal match; the array is the
      // authoritative status channel used by newer clients.
      pendingCommunityGame: hasResolvedMatch
        ? undefined
        : pendingCommunityGames[0],
      pendingCommunityGames,
    });
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
    igdbId: game.id,
    name: game.name,
    coverUrl:
      coverUrl ??
      (game.cover?.image_id
        ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover.image_id}.jpg`
        : ""),
    source: "igdb" as const,
    releaseYear: game.first_release_date
      ? new Date(game.first_release_date * 1000).getFullYear()
      : undefined,
  };
}

type DatabaseMatchRow = {
  platform: string;
  kind: string;
  value: string;
  id: number;
  igdb_id: number | null;
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

function emulatorContentLookupKey(
  item: Pick<
    EmulatorResolveRequest["items"][number],
    "emulatorId" | "contentKind" | "contentValue"
  >,
) {
  return `${item.emulatorId}:${item.contentKind}:${item.contentValue}`.toLowerCase();
}

function emulatorRowToGame(row: {
  id: number;
  igdb_id: number | null;
  name: string;
  cover_url: string | null;
}): Game {
  return {
    id: row.id,
    igdbId: row.igdb_id ?? undefined,
    name: row.name,
    coverUrl: row.cover_url ?? "",
    source: "igdb",
  };
}

function normalizeIgdbTitle(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function dedupeIgdbGamesByIdentity(games: IgdbGame[]) {
  return [...new Map(games.map((game) => [game.id, game])).values()];
}

function dedupeGamesByIdentity(games: Game[]) {
  return [
    ...new Map(
      games.map((game) => [
        game.igdbId ? `igdb:${game.igdbId}` : `${game.source}:${game.id}`,
        game,
      ]),
    ).values(),
  ];
}

export function createRepository(): PlayCounterRepository {
  if (process.env.DATABASE_URL)
    return new PostgresRepository(process.env.DATABASE_URL);
  return new MemoryRepository();
}
