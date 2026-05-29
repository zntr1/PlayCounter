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
  IGDB_GAME_ID: z.string().min(1).optional(),
});

const env = envSchema.parse(process.env);
const gameId = process.argv[2] ?? env.IGDB_GAME_ID;
if (!gameId) throw new Error("Usage: tsx src/add-game-by-id.ts <igdb id>");
if (!/^\d+$/.test(gameId)) throw new Error("IGDB game id must be numeric.");

const resolvedClientId = env.IGDB_CLIENT_ID ?? env.TWITCH_CLIENT_ID;
if (!resolvedClientId)
  throw new Error("Set IGDB_CLIENT_ID or TWITCH_CLIENT_ID.");
const clientId: string = resolvedClientId;

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

type IgdbGame = {
  id: number;
  name: string;
  cover?: { image_id?: string };
};

function inferExeNames(name: string): string[] {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
  return normalized ? [`${normalized}.exe`] : [];
}

async function fetchTwitchAccessToken() {
  if (!env.TWITCH_CLIENT_SECRET)
    throw new Error("Set IGDB_ACCESS_TOKEN or TWITCH_CLIENT_SECRET.");

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: env.TWITCH_CLIENT_SECRET,
    grant_type: "client_credentials",
  });
  const response = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    body: params,
  });

  if (!response.ok)
    throw new Error(
      `Twitch token request failed: ${response.status} ${await response.text()}`,
    );

  return z
    .object({ access_token: z.string().min(1) })
    .parse(await response.json()).access_token;
}

const accessToken = env.IGDB_ACCESS_TOKEN ?? (await fetchTwitchAccessToken());

const response = await fetch("https://api.igdb.com/v4/games", {
  method: "POST",
  headers: {
    "Client-ID": clientId,
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  },
  body: `fields name,cover.image_id; where id = ${gameId}; limit 1;`,
});

if (!response.ok)
  throw new Error(
    `IGDB request failed: ${response.status} ${await response.text()}`,
  );

const game = ((await response.json()) as IgdbGame[])[0];
if (!game) throw new Error(`No IGDB game found for id ${gameId}.`);

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
  const dbGameId = result.rows[0].id;

  for (const exeName of inferExeNames(game.name)) {
    await client.query(
      `INSERT INTO igdb_game_identifiers (platform, kind, value, game_id)
       VALUES ('windows', 'exe', $1, $2)
       ON CONFLICT (platform, kind, value)
       DO UPDATE SET game_id = excluded.game_id`,
      [exeName, dbGameId],
    );
  }

  await client.query("COMMIT");
  console.log(`Added ${game.name} (IGDB ${game.id}, DB ${dbGameId}).`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
