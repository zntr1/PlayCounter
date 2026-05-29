CREATE TABLE IF NOT EXISTS igdb_game_identifiers (
  platform TEXT NOT NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  game_id INTEGER NOT NULL REFERENCES igdb_games(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, kind, value)
);

CREATE INDEX IF NOT EXISTS idx_igdb_game_identifiers_game_id
  ON igdb_game_identifiers(game_id);

CREATE TABLE IF NOT EXISTS community_game_identifiers (
  platform TEXT NOT NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  game_id INTEGER NOT NULL REFERENCES community_games(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, kind, value)
);

CREATE INDEX IF NOT EXISTS idx_community_game_identifiers_game_id
  ON community_game_identifiers(game_id);

INSERT INTO igdb_game_identifiers (platform, kind, value, game_id)
SELECT 'windows', 'exe', lower(exe_name), game_id
FROM igdb_game_exes
ON CONFLICT (platform, kind, value)
DO UPDATE SET game_id = excluded.game_id;

INSERT INTO community_game_identifiers (platform, kind, value, game_id)
SELECT 'windows', 'exe', lower(exe_name), game_id
FROM community_game_exes
ON CONFLICT (platform, kind, value)
DO UPDATE SET game_id = excluded.game_id;
