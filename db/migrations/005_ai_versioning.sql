ALTER TABLE ai_investigations
  ADD COLUMN IF NOT EXISTS prompt_version TEXT NOT NULL
  DEFAULT 'payment-investigation-v1';
