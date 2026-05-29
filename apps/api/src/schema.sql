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

CREATE TABLE IF NOT EXISTS community_games (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  cover_url TEXT,
  submitted_by TEXT,
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS community_game_identifiers (
  platform TEXT NOT NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  game_id INTEGER NOT NULL REFERENCES community_games(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, kind, value)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_community_game_identifiers_lookup_key
  ON community_game_identifiers (lower(platform), lower(kind), lower(value));

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
