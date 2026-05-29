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
if (!args.name || args.exeNames.length === 0) {
  throw new Error(
    [
      "Usage:",
      '  pnpm db:add-community-game -- --name "Game Name" --exe Game.exe [--exe Other.exe] [--cover-url https://...] [--submitted-by admin] [--unverified]',
      "",
      "Short form:",
      '  pnpm db:add-community-game -- "Game Name" Game.exe [Other.exe]',
    ].join("\n"),
  );
}

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const client = await pool.connect();

try {
  await client.query("BEGIN");

  const gameResult = await client.query<{ id: number }>(
    `INSERT INTO community_games (name, cover_url, submitted_by, verified)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [args.name, args.coverUrl, args.submittedBy, args.verified],
  );
  const gameId = gameResult.rows[0].id;

  for (const exeName of args.exeNames) {
    await client.query(
      `INSERT INTO community_game_identifiers (platform, kind, value, game_id)
       VALUES ('windows', 'exe', $1, $2)
       ON CONFLICT (lower(platform), lower(kind), lower(value))
       DO UPDATE SET value = excluded.value, game_id = excluded.game_id`,
      [exeName, gameId],
    );
  }

  await client.query("COMMIT");
  console.log(
    `Added ${args.verified ? "verified" : "unverified"} community game ${JSON.stringify(args.name)} (DB ${gameId}) for ${args.exeNames.join(", ")}.`,
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
};

function parseArgs(argv: string[]): Args {
  const result: Args = {
    name: "",
    exeNames: [],
    coverUrl: null,
    submittedBy: "admin",
    verified: true,
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

function normalizeExeName(value: string) {
  const exeName = value.trim();
  if (!exeName) return "";
  if (exeName.includes("\n") || exeName.includes("\r")) {
    throw new Error("Executable names cannot contain line breaks.");
  }
  return exeName;
}
