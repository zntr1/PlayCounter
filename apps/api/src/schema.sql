CREATE TABLE IF NOT EXISTS igdb_games (
  id SERIAL PRIMARY KEY,
  igdb_id INTEGER UNIQUE,
  name TEXT NOT NULL,
  cover_url TEXT
);

CREATE TABLE IF NOT EXISTS igdb_game_identifiers (
  platform TEXT NOT NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  game_id INTEGER NOT NULL REFERENCES igdb_games(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, kind, value)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_igdb_game_identifiers_lookup_key
  ON igdb_game_identifiers (lower(platform), lower(kind), lower(value));

-- Candidate sets from ambiguous IGDB live lookups; unioned into the match
-- merge so the picker is served from the database without repeating lookups.
CREATE TABLE IF NOT EXISTS igdb_ambiguous_game_identifiers (
  platform TEXT NOT NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  game_id INTEGER NOT NULL REFERENCES igdb_games(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, kind, value, game_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_igdb_ambiguous_identifiers_lookup_key
  ON igdb_ambiguous_game_identifiers (lower(platform), lower(kind), lower(value), game_id);

-- Content identity inside an emulator is deliberately separate from native
-- process identifiers. Candidate rows may be many-to-one; curated rows are
-- restricted to one verified game per emulator content token.
CREATE TABLE IF NOT EXISTS emulator_content_identifiers (
  emulator_id TEXT NOT NULL,
  content_kind TEXT NOT NULL
    CHECK (content_kind IN ('conf', 'program', 'folder', 'rom', 'title_id')),
  content_value TEXT NOT NULL,
  game_id INTEGER NOT NULL REFERENCES igdb_games(id) ON DELETE CASCADE,
  confidence TEXT NOT NULL DEFAULT 'candidate'
    CHECK (confidence IN ('curated', 'candidate')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (emulator_id, content_kind, content_value, game_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_emulator_content_lookup_key
  ON emulator_content_identifiers
     (lower(emulator_id), lower(content_kind), lower(content_value), game_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_emulator_content_curated_unique
  ON emulator_content_identifiers
     (lower(emulator_id), lower(content_kind), lower(content_value))
  WHERE confidence = 'curated';

-- One row per game, reused across every executable that starts it: a
-- suggestion for a game that already exists attaches another identifier
-- instead of creating a second row. `igdb_id` is that identity — names are not
-- unique (remakes, re-releases) — and is NULL only for rows predating it and
-- for suggestions from clients that do not send it yet. `verified` is only
-- kept for older deployed clients; matching reads the per-identifier flag.
CREATE TABLE IF NOT EXISTS community_games (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  cover_url TEXT,
  submitted_by TEXT,
  verified BOOLEAN DEFAULT false,
  igdb_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_community_games_igdb_id
  ON community_games (igdb_id)
  WHERE igdb_id IS NOT NULL;

-- Community game ids retired by a merge. Desktop clients cache a matched game
-- id indefinitely, so those ids stay resolvable until the client re-matches
-- the executable and moves to the surviving entry.
CREATE TABLE IF NOT EXISTS community_game_aliases (
  old_game_id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES community_games(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One identifier may map to several community games: disagreeing suggestions
-- coexist as separate pending entries, verified collisions reach the picker.
-- Every identifier is reviewed on its own, so a second exe suggested for an
-- already verified game does not go live until it is verified too:
--   UPDATE community_game_identifiers SET verified = true
--   WHERE lower(value) = lower('Game.exe');
CREATE TABLE IF NOT EXISTS community_game_identifiers (
  platform TEXT NOT NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  game_id INTEGER NOT NULL REFERENCES community_games(id) ON DELETE CASCADE,
  verified BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'rejected')),
  review_note TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, kind, value, game_id),
  CONSTRAINT community_identifier_status_matches_verified
    CHECK (verified = (status = 'verified'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_community_game_identifiers_lookup_key
  ON community_game_identifiers (lower(platform), lower(kind), lower(value), game_id);

CREATE OR REPLACE FUNCTION sync_community_identifier_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.verified IS DISTINCT FROM OLD.verified
     AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    NEW.status := CASE WHEN NEW.verified THEN 'verified' ELSE 'pending' END;
    IF NEW.verified THEN
      NEW.review_note := NULL;
      NEW.reviewed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_community_identifier_status
  ON community_game_identifiers;
CREATE TRIGGER trg_sync_community_identifier_status
  BEFORE UPDATE ON community_game_identifiers
  FOR EACH ROW EXECUTE FUNCTION sync_community_identifier_status();

CREATE TABLE IF NOT EXISTS community_identifier_submissions (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  game_id INTEGER NOT NULL,
  install_uuid TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (platform, kind, value, game_id)
    REFERENCES community_game_identifiers (platform, kind, value, game_id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_community_submissions_unique
  ON community_identifier_submissions
     (lower(platform), lower(kind), lower(value), game_id, install_uuid);
CREATE INDEX IF NOT EXISTS idx_community_submissions_install
  ON community_identifier_submissions (install_uuid);

-- Anonymous negative match evidence. Reports never affect matching directly;
-- an operator promotes a reviewed executable to problematic_game_identifiers.
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

-- Verified non-unique executable names always use the ambiguity picker. Their
-- legitimate candidate rows remain in the IGDB/community identifier tables.
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

-- Anonymous, install-deduplicated evidence for review. Kept separate from
-- wrong-match reports so the two signals can never overwrite one another.
CREATE TABLE IF NOT EXISTS community_ignored_process_reports (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  install_uuid TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'rejected')),
  review_note TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ignored_report_canonical_case
    CHECK (platform = lower(platform) AND kind = lower(kind) AND value = lower(value)),
  CONSTRAINT ignored_report_platform_kind
    CHECK ((platform, kind) IN
      (('windows', 'exe'), ('macos', 'process_name'), ('linux', 'executable_name'))),
  CONSTRAINT ignored_report_exact_name
    CHECK (
      value = btrim(value)
      AND length(value) BETWEEN 1 AND 260
      AND value !~ '[*?]'
      AND value !~ '[/\\]'
      AND value !~ '[[:cntrl:]]'
    ),
  CONSTRAINT ignored_report_install_unique
    UNIQUE (platform, kind, value, install_uuid)
);

CREATE INDEX IF NOT EXISTS idx_ignored_process_reports_pending
  ON community_ignored_process_reports (platform, value)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS live_sessions (
  install_uuid TEXT NOT NULL,
  game_id INTEGER NOT NULL,
  game_source TEXT NOT NULL DEFAULT 'igdb' CHECK (game_source IN ('igdb', 'community')),
  last_ping TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (install_uuid, game_source, game_id)
);

CREATE TABLE IF NOT EXISTS daily_stats (
  game_id INTEGER NOT NULL,
  game_source TEXT NOT NULL DEFAULT 'igdb' CHECK (game_source IN ('igdb', 'community')),
  date DATE NOT NULL,
  player_count INTEGER NOT NULL DEFAULT 0,
  total_hours NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (game_source, game_id, date)
);

CREATE TABLE IF NOT EXISTS feedback (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('bug', 'feature', 'other')),
  message TEXT NOT NULL,
  app_version TEXT,
  platform TEXT,
  install_uuid UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
