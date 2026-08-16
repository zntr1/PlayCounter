-- Negative match reports are evidence only. They do not affect matching until
-- an operator verifies that the executable name is globally problematic and
-- adds it to problematic_game_identifiers.
--
-- Promotion must happen only after the API version that reads the problematic
-- table is deployed. Preserve any normal IGDB row as an ambiguous candidate
-- before removing the one-to-one mapping:
--
--   BEGIN;
--   INSERT INTO problematic_game_identifiers
--     (platform, kind, value, reason, note)
--   VALUES ('windows', 'exe', lower('ai.exe'), 'not_a_game', 'review note')
--   ON CONFLICT (platform, kind, value)
--   DO UPDATE SET reason = excluded.reason,
--                 note = excluded.note,
--                 updated_at = now();
--   INSERT INTO igdb_ambiguous_game_identifiers
--     (platform, kind, value, game_id)
--   SELECT platform, kind, value, game_id
--   FROM igdb_game_identifiers
--   WHERE lower(platform) = 'windows'
--     AND lower(kind) = 'exe'
--     AND lower(value) = 'ai.exe'
--   ON CONFLICT DO NOTHING;
--   DELETE FROM igdb_game_identifiers
--   WHERE lower(platform) = 'windows'
--     AND lower(kind) = 'exe'
--     AND lower(value) = 'ai.exe';
--   UPDATE community_identifier_reports
--   SET status = 'verified', reviewed_at = now()
--   WHERE value = 'ai.exe' AND status = 'pending';
--   COMMIT;
--
-- Verified community candidates are deliberately retained; the problematic
-- flag makes them picker candidates. Do not delete an IGDB mapping merely to
-- reject it: live IGDB fallback would recreate it. Mapping-specific IGDB
-- rejection needs its own durable model.

CREATE TABLE IF NOT EXISTS community_identifier_reports (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  game_id INTEGER,
  game_source TEXT CHECK (game_source IN ('igdb', 'community')),
  reason TEXT NOT NULL CHECK (reason = 'not_a_game'),
  install_uuid TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'rejected')),
  review_note TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT identifier_report_game_identity
    CHECK ((game_id IS NULL) = (game_source IS NULL)),
  CONSTRAINT identifier_report_canonical_case
    CHECK (
      platform = lower(platform)
      AND kind = lower(kind)
      AND value = lower(value)
    ),
  CONSTRAINT identifier_report_install_unique
    UNIQUE (platform, kind, value, install_uuid)
);

CREATE INDEX IF NOT EXISTS idx_identifier_reports_pending
  ON community_identifier_reports (value)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS problematic_game_identifiers (
  platform TEXT NOT NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT 'not_a_game'
    CHECK (reason IN ('not_a_game', 'ambiguous')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, kind, value),
  CONSTRAINT problematic_identifier_canonical_case
    CHECK (
      platform = lower(platform)
      AND kind = lower(kind)
      AND value = lower(value)
    )
);
