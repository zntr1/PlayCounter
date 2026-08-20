-- Manual emulator picks wait here for explicit review. They deliberately do
-- not enter emulator_content_identifiers: one candidate identifier is already
-- enough to produce a probable match and be auto-applied by the desktop.
CREATE TABLE IF NOT EXISTS emulator_content_suggestions (
  emulator_id TEXT NOT NULL,
  content_kind TEXT NOT NULL
    CHECK (content_kind IN ('conf', 'program', 'rom', 'title_id')),
  content_value TEXT NOT NULL,
  game_id INTEGER NOT NULL REFERENCES igdb_games(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (emulator_id, content_kind, content_value, game_id),
  CONSTRAINT emulator_suggestion_canonical_case CHECK (
    emulator_id = lower(emulator_id)
    AND content_kind = lower(content_kind)
    AND content_value = lower(content_value)
  ),
  CONSTRAINT emulator_suggestion_value_shape CHECK (
    content_value = btrim(content_value)
    AND length(content_value) BETWEEN 2 AND 96
    AND content_value !~ '[\\/:]'
    AND content_value !~ '[[:cntrl:]]'
  )
);

CREATE INDEX IF NOT EXISTS idx_emulator_suggestions_pending
  ON emulator_content_suggestions (emulator_id, content_value)
  WHERE status = 'pending';

-- Anonymous per-install evidence. Counts help review, but never auto-approve.
CREATE TABLE IF NOT EXISTS emulator_content_submissions (
  id BIGSERIAL PRIMARY KEY,
  emulator_id TEXT NOT NULL,
  content_kind TEXT NOT NULL,
  content_value TEXT NOT NULL,
  game_id INTEGER NOT NULL,
  install_uuid TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (emulator_id, content_kind, content_value, game_id)
    REFERENCES emulator_content_suggestions
      (emulator_id, content_kind, content_value, game_id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_emulator_submissions_unique
  ON emulator_content_submissions
     (emulator_id, content_kind, content_value, game_id, install_uuid);

CREATE INDEX IF NOT EXISTS idx_emulator_submissions_install
  ON emulator_content_submissions (install_uuid);
