import pg from "pg";
import { z } from "zod";
import { loadDotEnv } from "./env.js";

loadDotEnv();

const env = z
  .object({
    DATABASE_URL: z.string().url(),
  })
  .parse(process.env);

const args = parseArgs(process.argv.slice(2));
if ((!args.name && args.gameId === null) || args.exeNames.length === 0) {
  throw new Error(
    [
      "Usage:",
      '  pnpm db:add-community-game -- --name "Game Name" --exe Game.exe [--exe Other.exe] [--igdb-id 12345] [--cover-url https://...] [--submitted-by admin] [--unverified]',
      "",
      "Add executables to an existing entry (no name needed):",
      "  pnpm db:add-community-game -- --game-id 84 --exe Other.exe",
      "",
      "Short form:",
      '  pnpm db:add-community-game -- "Game Name" Game.exe [Other.exe]',
      "",
      "Which entry an executable joins is decided by --game-id, else --igdb-id,",
      "else name plus identical cover art. Two games can share a title, so",
      "without --igdb-id or a matching cover a new entry is created.",
    ].join("\n"),
  );
}

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const client = await pool.connect();

try {
  await client.query("BEGIN");

  // Adding more executables for a game that already exists extends that entry
  // instead of creating a second one. Same identity rule as the API: the IGDB
  // id decides, and the name only counts together with identical cover art,
  // because different games do share titles.
  const knownGame = await client.query<{ id: number; name: string }>(
    `SELECT id, name FROM community_games
     WHERE ($1::int IS NOT NULL AND id = $1::int)
        OR ($1::int IS NULL AND $2::int IS NOT NULL AND igdb_id = $2::int)
        OR (
          $1::int IS NULL
          AND lower(name) = lower($3)
          AND ($4::text IS NOT NULL AND cover_url = $4::text)
          AND ($2::int IS NULL OR igdb_id IS NULL)
        )
     ORDER BY id ASC
     LIMIT 1`,
    [args.gameId, args.igdbId, args.name, args.coverUrl],
  );
  let gameId = knownGame.rows[0]?.id;
  const reusedGame = gameId !== undefined;

  if (args.gameId !== null && gameId === undefined) {
    throw new Error(`No community game with id ${args.gameId}.`);
  }

  const gameName = knownGame.rows[0]?.name ?? args.name;

  if (gameId === undefined) {
    const gameResult = await client.query<{ id: number }>(
      `INSERT INTO community_games (name, cover_url, submitted_by, verified, igdb_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [args.name, args.coverUrl, args.submittedBy, args.verified, args.igdbId],
    );
    gameId = gameResult.rows[0].id;
  } else if (args.igdbId !== null) {
    // Give a row that was created before igdb ids existed its identity, so
    // later runs and client suggestions no longer depend on the name.
    await client.query(
      `UPDATE community_games SET igdb_id = $2
       WHERE id = $1 AND igdb_id IS NULL`,
      [gameId, args.igdbId],
    );
  }

  for (const exeName of args.exeNames) {
    await client.query(
      `INSERT INTO community_game_identifiers (platform, kind, value, game_id, verified)
       VALUES ('windows', 'exe', $1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [exeName, gameId, args.verified],
    );
    // An identifier that already existed (possibly in different casing) keeps
    // its row but takes the review state this run asks for.
    await client.query(
      `UPDATE community_game_identifiers
       SET verified = $3
       WHERE lower(platform) = 'windows'
         AND lower(kind) = 'exe'
         AND lower(value) = lower($1)
         AND game_id = $2`,
      [exeName, gameId, args.verified],
    );
  }

  await client.query("COMMIT");
  console.log(
    `${reusedGame ? "Extended" : "Added"} ${args.verified ? "verified" : "unverified"} community game ${JSON.stringify(gameName)} (DB ${gameId}) for ${args.exeNames.join(", ")}.`,
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}

type Args = {
  name: string;
  exeNames: string[];
  coverUrl: string | null;
  submittedBy: string | null;
  verified: boolean;
  // Identity of the entry the executables join: an explicit community game id
  // wins, then the IGDB id of the game's metadata.
  gameId: number | null;
  igdbId: number | null;
};

function parseArgs(argv: string[]): Args {
  const result: Args = {
    name: "",
    exeNames: [],
    coverUrl: null,
    submittedBy: "admin",
    verified: true,
    gameId: null,
    igdbId: null,
  };
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--name") {
      result.name = requiredValue(arg, next);
      index += 1;
    } else if (arg === "--exe") {
      result.exeNames.push(normalizeExeName(requiredValue(arg, next)));
      index += 1;
    } else if (arg === "--cover-url") {
      result.coverUrl = requiredValue(arg, next);
      index += 1;
    } else if (arg === "--game-id") {
      result.gameId = requiredNumber(arg, next);
      index += 1;
    } else if (arg === "--igdb-id") {
      result.igdbId = requiredNumber(arg, next);
      index += 1;
    } else if (arg === "--submitted-by") {
      result.submittedBy = requiredValue(arg, next);
      index += 1;
    } else if (arg === "--unverified") {
      result.verified = false;
    } else {
      positional.push(arg);
    }
  }

  if (!result.name && positional.length > 0) result.name = positional[0].trim();
  for (const exeName of positional.slice(1)) {
    result.exeNames.push(normalizeExeName(exeName));
  }

  result.name = result.name.trim();
  result.exeNames = [...new Set(result.exeNames)].filter(Boolean);
  return result;
}

function requiredValue(flag: string, value: string | undefined) {
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value.trim();
}

function requiredNumber(flag: string, value: string | undefined) {
  const parsed = Number(requiredValue(flag, value));
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive integer.`);
  }
  return parsed;
}

function normalizeExeName(value: string) {
  const exeName = value.trim();
  if (!exeName) return "";
  if (exeName.includes("\n") || exeName.includes("\r")) {
    throw new Error("Executable names cannot contain line breaks.");
  }
  return exeName;
}
