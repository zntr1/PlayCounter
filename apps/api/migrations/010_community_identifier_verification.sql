-- A game can be started by several executables (launcher, anti-cheat wrapper,
-- client). Those belong to one community game, so a suggestion for a second
-- exe now attaches to the existing entry instead of creating a second game.
--
-- That moves the review gate: verification has to live on the identifier, not
-- on the game. Otherwise attaching any exe to an already verified game would
-- publish it to every user without review.
ALTER TABLE community_game_identifiers
  ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false;

-- Existing identifiers inherit the review state of the game they belong to.
UPDATE community_game_identifiers AS identifiers
SET verified = true
FROM community_games
WHERE community_games.id = identifiers.game_id
  AND COALESCE(community_games.verified, false) = true;

-- Identity of a community game. Names are not unique (remakes, re-releases,
-- unrelated indies), so the IGDB id of the metadata the suggester picked is
-- what decides whether a suggestion joins an existing game. NULL for rows
-- created before this column and for suggestions from older clients.
ALTER TABLE community_games
  ADD COLUMN IF NOT EXISTS igdb_id INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_community_games_igdb_id
  ON community_games (igdb_id)
  WHERE igdb_id IS NOT NULL;

-- Merge the community games that only exist twice because the same game was
-- suggested under two executables (Albion Online, Minecraft, ...). The oldest
-- row of each group is kept; every identifier moves onto it.
--
-- Existing rows have no igdb_id yet, so the group is name plus cover art: the
-- cover URL carries the IGDB image id of the metadata that was picked, which
-- makes two rows the same game far more reliably than the name alone. Rows
-- without a cover are never merged — nothing there proves they are the same
-- game, and the merge cannot be undone.
CREATE TEMP TABLE community_game_canonicals ON COMMIT DROP AS
SELECT games.id AS game_id,
       (
         SELECT other.id
         FROM community_games other
         WHERE lower(other.name) = lower(games.name)
           AND other.cover_url = games.cover_url
         ORDER BY other.id ASC
         LIMIT 1
       ) AS canonical_id
FROM community_games games
WHERE games.cover_url IS NOT NULL;

-- The kept row stays usable for the still-deployed API, which reads
-- community_games.verified: a merged group counts as verified if any member was.
UPDATE community_games canonical
SET verified = true
FROM community_game_canonicals canonicals
INNER JOIN community_games duplicate ON duplicate.id = canonicals.game_id
WHERE canonical.id = canonicals.canonical_id
  AND canonicals.canonical_id <> canonicals.game_id
  AND COALESCE(duplicate.verified, false) = true;

-- The same exe can sit on several of the rows being merged. Only the copy on
-- the oldest game survives, and it keeps the review state of any of them.
UPDATE community_game_identifiers keep
SET verified = true
FROM community_game_identifiers remove,
     community_game_canonicals keep_map,
     community_game_canonicals remove_map
WHERE keep_map.game_id = keep.game_id
  AND remove_map.game_id = remove.game_id
  AND keep_map.canonical_id = remove_map.canonical_id
  AND keep.game_id < remove.game_id
  AND lower(keep.platform) = lower(remove.platform)
  AND lower(keep.kind) = lower(remove.kind)
  AND lower(keep.value) = lower(remove.value)
  AND remove.verified = true;

DELETE FROM community_game_identifiers remove
USING community_game_identifiers keep,
      community_game_canonicals keep_map,
      community_game_canonicals remove_map
WHERE keep_map.game_id = keep.game_id
  AND remove_map.game_id = remove.game_id
  AND keep_map.canonical_id = remove_map.canonical_id
  AND keep.game_id < remove.game_id
  AND lower(keep.platform) = lower(remove.platform)
  AND lower(keep.kind) = lower(remove.kind)
  AND lower(keep.value) = lower(remove.value);

UPDATE community_game_identifiers identifiers
SET game_id = canonicals.canonical_id
FROM community_game_canonicals canonicals
WHERE canonicals.game_id = identifiers.game_id
  AND canonicals.canonical_id <> identifiers.game_id;

-- Desktop clients cache a matched community game id indefinitely, so the ids
-- that disappear here have to stay resolvable: a client still holding an old
-- id re-checks its executable and is moved to the kept game. Without this a
-- client keeps two ids for one game and records two parallel sessions.
CREATE TABLE IF NOT EXISTS community_game_aliases (
  old_game_id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES community_games(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO community_game_aliases (old_game_id, game_id)
SELECT canonicals.game_id, canonicals.canonical_id
FROM community_game_canonicals canonicals
WHERE canonicals.canonical_id <> canonicals.game_id
ON CONFLICT (old_game_id) DO NOTHING;

DELETE FROM community_games games
USING community_game_canonicals canonicals
WHERE canonicals.game_id = games.id
  AND canonicals.canonical_id <> games.id;
