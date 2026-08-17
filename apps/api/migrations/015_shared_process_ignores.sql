-- Anonymous suggestions that an executable belongs in the manually maintained
-- system ignore list. This is deliberately separate from
-- community_identifier_reports so ignore suggestions can never overwrite
-- wrong-match evidence from the same installation.
--
-- Mark reviewed after manually deciding whether to update the packaged list:
--   UPDATE community_ignored_process_reports
--   SET status = 'verified', review_note = 'Added manually to packaged list',
--       reviewed_at = now(), updated_at = now()
--   WHERE platform = 'windows' AND kind = 'exe'
--     AND value = lower('NvContainer.exe') AND status = 'pending';
--
-- Reject:
--   UPDATE community_ignored_process_reports
--   SET status = 'rejected', review_note = 'Actually a game launcher',
--       reviewed_at = now(), updated_at = now()
--   WHERE platform = 'windows' AND kind = 'exe'
--     AND value = lower('Foo.exe') AND status = 'pending';

CREATE TABLE IF NOT EXISTS community_ignored_process_reports (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  install_uuid TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'rejected')),
  review_note TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ignored_report_canonical_case
    CHECK (platform = lower(platform) AND kind = lower(kind) AND value = lower(value)),
  CONSTRAINT ignored_report_platform_kind
    CHECK ((platform, kind) IN
      (('windows', 'exe'), ('macos', 'process_name'), ('linux', 'executable_name'))),
  CONSTRAINT ignored_report_exact_name
    CHECK (
      value = btrim(value)
      AND length(value) BETWEEN 1 AND 260
      AND value !~ '[*?]'
      AND value !~ '[/\\]'
      AND value !~ '[[:cntrl:]]'
    ),
  CONSTRAINT ignored_report_install_unique
    UNIQUE (platform, kind, value, install_uuid)
);

CREATE INDEX IF NOT EXISTS idx_ignored_process_reports_pending
  ON community_ignored_process_reports (platform, value)
  WHERE status = 'pending';
