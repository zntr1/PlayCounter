ALTER TABLE live_sessions DROP CONSTRAINT IF EXISTS live_sessions_pkey;

ALTER TABLE live_sessions ALTER COLUMN install_uuid SET NOT NULL;

ALTER TABLE live_sessions ADD PRIMARY KEY (install_uuid, game_id);
