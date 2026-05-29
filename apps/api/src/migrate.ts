import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { z } from "zod";
import { loadDotEnv } from "./env.js";

loadDotEnv();

const env = z
  .object({
    DATABASE_URL: z.string().url(),
  })
  .parse(process.env);

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(dirname, "../migrations");
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

await pool.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`);

const appliedResult = await pool.query<{ filename: string }>(
  "SELECT filename FROM schema_migrations",
);
const applied = new Set(appliedResult.rows.map((row) => row.filename));
const migrationFiles = (await readdir(migrationsDir))
  .filter((file) => file.endsWith(".sql"))
  .sort();

for (const filename of migrationFiles) {
  if (applied.has(filename)) continue;

  const client = await pool.connect();
  try {
    const sql = await readFile(path.join(migrationsDir, filename), "utf8");
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [
      filename,
    ]);
    await client.query("COMMIT");
    console.log(`Applied ${filename}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

await pool.end();
