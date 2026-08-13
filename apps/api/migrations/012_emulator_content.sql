-- Content identity inside an emulator. This deliberately has a separate key
-- space from native process identifiers: a DOS executable is not a Windows
-- process executable, and short DOS names collide frequently.
CREATE TABLE IF NOT EXISTS emulator_content_identifiers (
  emulator_id TEXT NOT NULL,
  content_kind TEXT NOT NULL CHECK (content_kind IN ('conf', 'program', 'folder')),
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
