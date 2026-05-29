CREATE TABLE IF NOT EXISTS feedback (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('bug', 'feature', 'other')),
  message TEXT NOT NULL,
  app_version TEXT,
  platform TEXT,
  install_uuid UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
