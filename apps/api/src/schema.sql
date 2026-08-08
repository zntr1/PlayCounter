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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, kind, value, game_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_community_game_identifiers_lookup_key
  ON community_game_identifiers (lower(platform), lower(kind), lower(value), game_id);

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
