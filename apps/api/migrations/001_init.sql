CREATE TABLE IF NOT EXISTS igdb_games (
  id SERIAL PRIMARY KEY,
  igdb_id INTEGER UNIQUE,
  name TEXT NOT NULL,
  cover_url TEXT
);

CREATE TABLE IF NOT EXISTS igdb_game_exes (
  exe_name TEXT PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES igdb_games(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_igdb_game_exes_game_id ON igdb_game_exes(game_id);

CREATE TABLE IF NOT EXISTS community_games (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  cover_url TEXT,
  submitted_by TEXT,
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS community_game_exes (
  exe_name TEXT PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES community_games(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_community_game_exes_game_id ON community_game_exes(game_id);

CREATE TABLE IF NOT EXISTS live_sessions (
  install_uuid TEXT NOT NULL,
  game_id INTEGER NOT NULL,
  last_ping TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (install_uuid, game_id)
);

CREATE TABLE IF NOT EXISTS daily_stats (
  game_id INTEGER NOT NULL,
  date DATE NOT NULL,
  player_count INTEGER NOT NULL DEFAULT 0,
  total_hours NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, date)
);
