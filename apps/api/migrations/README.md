# Database migrations

Migrations are plain SQL files named `NNN_description.sql`, applied in filename
order by `pnpm --filter @playcounter/api db:migrate` (see `../src/migrate.ts`).
Each file runs once inside a transaction and is recorded in `schema_migrations`.

CI runs the migrate step against the target environment's `DATABASE_URL`
**before** the new API code is deployed:

- `test` branch → `test` environment → `playcounter` database
- `main` branch → `production` environment → `playcounter_prod` database

## Rule: migrations must be backward compatible (expand / contract)

Because migrations run before the new API rolls out — and during a rollout the
old and new API run against the same schema — every migration must keep the
**currently deployed** API working. Never break a running client or API.

Use the expand/contract pattern across releases:

1. **Expand** — add the new shape, additively:
   - Add columns as `NULL` or with a `DEFAULT`; never `NOT NULL` without a default.
   - Add new tables/indexes.
   - Backfill data in the same or a follow-up migration.
2. **Migrate code** — ship API + desktop that write/read the new shape while
   still tolerating the old shape.
3. **Contract** — only in a *later* release, once nothing reads the old shape:
   drop columns/tables, add constraints, rename via add-copy-drop.

### Do not, in a single release

- Drop or rename a column/table the deployed API still uses.
- Add a `NOT NULL` column without a default to a populated table.
- Change a column type in a way that rejects existing rows.

Renames are a multi-step expand/contract: add the new column, dual-write,
backfill, switch reads, then drop the old column in a later migration.
