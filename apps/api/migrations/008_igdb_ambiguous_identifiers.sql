-- Exe mappings for ambiguous IGDB live-lookup results. The main
-- igdb_game_identifiers table holds exactly one game per identifier, so
-- ambiguous candidate sets get their own table. The match merge unions these
-- rows in, which surfaces the picker from the database (together with any
-- community entry for the same exe) instead of repeating the IGDB lookup.
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
