-- Allow multiple community games per identifier so a suggestion for a
-- different game no longer gets swallowed by the first entry for that exe.
-- Disagreeing suggestions now coexist as separate pending entries, and
-- multiple verified entries for one exe reach the ambiguous picker.
ALTER TABLE community_game_identifiers
  DROP CONSTRAINT community_game_identifiers_pkey;
ALTER TABLE community_game_identifiers
  ADD PRIMARY KEY (platform, kind, value, game_id);

DROP INDEX IF EXISTS idx_community_game_identifiers_lookup_key;
CREATE UNIQUE INDEX idx_community_game_identifiers_lookup_key
  ON community_game_identifiers (lower(platform), lower(kind), lower(value), game_id);
