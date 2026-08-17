-- Ignore suggestions are review evidence only. System ignore entries are
-- maintained manually in the packaged desktop resource lists and are never
-- distributed from the database.

DROP TABLE IF EXISTS ignored_process_identifiers;
DROP FUNCTION IF EXISTS reject_ignored_identifier_with_game();
