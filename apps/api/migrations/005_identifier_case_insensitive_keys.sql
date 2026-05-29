DELETE FROM igdb_game_identifiers keep
USING igdb_game_identifiers remove
WHERE lower(keep.platform) = lower(remove.platform)
  AND lower(keep.kind) = lower(remove.kind)
  AND lower(keep.value) = lower(remove.value)
  AND keep.ctid < remove.ctid;

DELETE FROM community_game_identifiers keep
USING community_game_identifiers remove
WHERE lower(keep.platform) = lower(remove.platform)
  AND lower(keep.kind) = lower(remove.kind)
  AND lower(keep.value) = lower(remove.value)
  AND keep.ctid < remove.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_igdb_game_identifiers_lookup_key
  ON igdb_game_identifiers (lower(platform), lower(kind), lower(value));

CREATE UNIQUE INDEX IF NOT EXISTS idx_community_game_identifiers_lookup_key
  ON community_game_identifiers (lower(platform), lower(kind), lower(value));
