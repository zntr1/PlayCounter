import pg from "pg";
import { z } from "zod";
import { loadDotEnv } from "./env.js";

loadDotEnv();

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  IGDB_CLIENT_ID: z.string().min(1).optional(),
  IGDB_ACCESS_TOKEN: z.string().min(1).optional(),
  TWITCH_CLIENT_ID: z.string().min(1).optional(),
  TWITCH_CLIENT_SECRET: z.string().min(1).optional(),
  IGDB_SEED_LIMIT: z.coerce.number().int().positive().optional(),
  IGDB_START_AFTER_ID: z.coerce.number().int().nonnegative().default(0),
  IGDB_BATCH_SIZE: z.coerce.number().int().positive().max(500).default(500),
  IGDB_REQUEST_DELAY_MS: z.coerce.number().int().nonnegative().default(300),
});

const env = envSchema.parse(process.env);
const resolvedClientId = env.IGDB_CLIENT_ID ?? env.TWITCH_CLIENT_ID;
if (!resolvedClientId)
  throw new Error("Set IGDB_CLIENT_ID or TWITCH_CLIENT_ID.");
const clientId: string = resolvedClientId;

type IgdbGame = {
  id: number;
  name: string;
  cover?: { image_id?: string };
};

type Counters = {
  fetched: number;
  gamesUpserted: number;
  identifiersInserted: number;
  duplicateIdentifiers: number;
  skipped: number;
  failed: number;
};

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const accessToken = env.IGDB_ACCESS_TOKEN ?? (await fetchTwitchAccessToken());
const counters: Counters = {
  fetched: 0,
  gamesUpserted: 0,
  identifiersInserted: 0,
  duplicateIdentifiers: 0,
  skipped: 0,
  failed: 0,
};

let lastIgdbId = env.IGDB_START_AFTER_ID;

try {
  while (
    env.IGDB_SEED_LIMIT === undefined ||
    counters.fetched < env.IGDB_SEED_LIMIT
  ) {
    const remaining =
      env.IGDB_SEED_LIMIT === undefined
        ? env.IGDB_BATCH_SIZE
        : Math.min(env.IGDB_BATCH_SIZE, env.IGDB_SEED_LIMIT - counters.fetched);
    if (remaining <= 0) break;

    const games = await fetchGamesAfterId(lastIgdbId, remaining);
    if (games.length === 0) break;

    for (const game of games) {
      lastIgdbId = Math.max(lastIgdbId, game.id);
      counters.fetched += 1;
      await upsertGame(game).catch((error) => {
        counters.failed += 1;
        console.error(
          `Failed IGDB ${game.id} ${JSON.stringify(game.name)}: ${formatError(error)}`,
        );
      });
    }

    console.log(
      [
        `lastIgdbId=${lastIgdbId}`,
        `fetched=${counters.fetched}`,
        `games=${counters.gamesUpserted}`,
        `identifiers=${counters.identifiersInserted}`,
        `duplicates=${counters.duplicateIdentifiers}`,
        `skipped=${counters.skipped}`,
        `failed=${counters.failed}`,
      ].join(" "),
    );

    if (games.length < remaining) break;
    await sleep(env.IGDB_REQUEST_DELAY_MS);
  }
} finally {
  await pool.end();
}

console.log(
  `Done. Fetched ${counters.fetched}, upserted ${counters.gamesUpserted}, inserted ${counters.identifiersInserted} windows/exe identifiers, ignored ${counters.duplicateIdentifiers} duplicates, skipped ${counters.skipped}, failed ${counters.failed}.`,
);

async function upsertGame(game: IgdbGame) {
  const exeNames = inferExeNames(game.name);
  if (exeNames.length === 0) {
    counters.skipped += 1;
    return;
  }

  const coverUrl = game.cover?.image_id
    ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover.image_id}.jpg`
    : null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ id: number }>(
      `INSERT INTO igdb_games (igdb_id, name, cover_url)
       VALUES ($1, $2, $3)
       ON CONFLICT (igdb_id)
       DO UPDATE SET name = excluded.name, cover_url = excluded.cover_url
       RETURNING id`,
      [game.id, game.name, coverUrl],
    );
    counters.gamesUpserted += 1;

    const dbGameId = result.rows[0].id;
    for (const exeName of exeNames) {
      const identifierResult = await client.query(
        `INSERT INTO igdb_game_identifiers (platform, kind, value, game_id)
         VALUES ('windows', 'exe', $1, $2)
         ON CONFLICT (platform, kind, value)
         DO NOTHING`,
        [exeName, dbGameId],
      );

      if (identifierResult.rowCount === 1) counters.identifiersInserted += 1;
      else counters.duplicateIdentifiers += 1;
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function fetchGamesAfterId(afterId: number, limit: number) {
  const body = [
    "fields name,cover.image_id;",
    `where id > ${afterId} & name != null;`,
    "sort id asc;",
    `limit ${limit};`,
  ].join(" ");

  const response = await fetchWithRetry("https://api.igdb.com/v4/games", {
    method: "POST",
    headers: {
      "Client-ID": clientId,
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    body,
  });

  return (await response.json()) as IgdbGame[];
}

async function fetchTwitchAccessToken() {
  if (!env.TWITCH_CLIENT_SECRET)
    throw new Error("Set IGDB_ACCESS_TOKEN or TWITCH_CLIENT_SECRET.");

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: env.TWITCH_CLIENT_SECRET,
    grant_type: "client_credentials",
  });
  const response = await fetchWithRetry("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    body: params,
  });

  return z
    .object({ access_token: z.string().min(1) })
    .parse(await response.json()).access_token;
}

async function fetchWithRetry(input: string, init: RequestInit, attempts = 5) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(input, init);
      if (response.ok) return response;

      const text = await response.text();
      if (response.status !== 429 && response.status < 500) {
        throw new Error(`${response.status} ${text}`);
      }

      lastError = new Error(`${response.status} ${text}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(Math.min(30_000, 1_000 * 2 ** (attempt - 1)));
  }

  throw lastError;
}

function inferExeNames(name: string): string[] {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
  return normalized ? [`${normalized}.exe`] : [];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
