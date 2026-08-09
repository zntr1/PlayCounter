-- Preserve review outcomes and attribute every installation that submits an
-- identifier/game pair. `verified` remains the matching gate for compatibility
-- with API and admin versions deployed before this migration.
ALTER TABLE community_game_identifiers
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'rejected')),
  ADD COLUMN IF NOT EXISTS review_note TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

UPDATE community_game_identifiers
SET status = CASE WHEN verified THEN 'verified' ELSE 'pending' END;

CREATE OR REPLACE FUNCTION sync_community_identifier_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.verified IS DISTINCT FROM OLD.verified
     AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    NEW.status := CASE WHEN NEW.verified THEN 'verified' ELSE 'pending' END;
    IF NEW.verified THEN
      NEW.review_note := NULL;
      NEW.reviewed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_community_identifier_status
  BEFORE UPDATE ON community_game_identifiers
  FOR EACH ROW EXECUTE FUNCTION sync_community_identifier_status();

ALTER TABLE community_game_identifiers
  ADD CONSTRAINT community_identifier_status_matches_verified
  CHECK (verified = (status = 'verified'));

CREATE TABLE IF NOT EXISTS community_identifier_submissions (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  game_id INTEGER NOT NULL,
  install_uuid TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (platform, kind, value, game_id)
    REFERENCES community_game_identifiers (platform, kind, value, game_id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_community_submissions_unique
  ON community_identifier_submissions
     (lower(platform), lower(kind), lower(value), game_id, install_uuid);
CREATE INDEX IF NOT EXISTS idx_community_submissions_install
  ON community_identifier_submissions (install_uuid);
