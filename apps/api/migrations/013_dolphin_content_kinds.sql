ALTER TABLE emulator_content_identifiers
  DROP CONSTRAINT IF EXISTS emulator_content_identifiers_content_kind_check;

ALTER TABLE emulator_content_identifiers
  ADD CONSTRAINT emulator_content_identifiers_content_kind_check
  CHECK (content_kind IN ('conf', 'program', 'folder', 'rom', 'title_id'));
