ALTER TABLE live_sessions
  ADD COLUMN IF NOT EXISTS game_source TEXT NOT NULL DEFAULT 'igdb'
  CHECK (game_source IN ('igdb', 'community'));

ALTER TABLE live_sessions DROP CONSTRAINT IF EXISTS live_sessions_pkey;

ALTER TABLE live_sessions
  ADD PRIMARY KEY (install_uuid, game_source, game_id);

ALTER TABLE daily_stats
  ADD COLUMN IF NOT EXISTS game_source TEXT NOT NULL DEFAULT 'igdb'
  CHECK (game_source IN ('igdb', 'community'));

ALTER TABLE daily_stats DROP CONSTRAINT IF EXISTS daily_stats_pkey;

ALTER TABLE daily_stats
  ADD PRIMARY KEY (game_source, game_id, date);
