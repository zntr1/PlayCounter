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

DROP TABLE IF EXISTS igdb_game_exes;
DROP TABLE IF EXISTS community_game_exes;
