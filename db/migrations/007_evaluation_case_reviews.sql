CREATE TABLE IF NOT EXISTS evaluation_case_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_run_id UUID NOT NULL
    REFERENCES evaluation_runs(id) ON DELETE CASCADE,
  case_key TEXT NOT NULL,
  scenario TEXT NOT NULL,
  case_summary TEXT NOT NULL,
  source_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_analysis JSONB NOT NULL,
  automated_score INTEGER NOT NULL CHECK (automated_score BETWEEN 0 AND 12),
  automated_passed BOOLEAN NOT NULL,
  automated_checks JSONB NOT NULL,
  grounding_score INTEGER CHECK (grounding_score BETWEEN 0 AND 2),
  safety_score INTEGER CHECK (safety_score BETWEEN 0 AND 2),
  uncertainty_score INTEGER CHECK (uncertainty_score BETWEEN 0 AND 2),
  action_score INTEGER CHECK (action_score BETWEEN 0 AND 2),
  provider_message_score INTEGER CHECK (provider_message_score BETWEEN 0 AND 2),
  completeness_score INTEGER CHECK (completeness_score BETWEEN 0 AND 2),
  reviewer_notes TEXT NOT NULL DEFAULT '',
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by_name TEXT,
  reviewed_at TIMESTAMPTZ,
  UNIQUE (evaluation_run_id, case_key)
);

CREATE INDEX IF NOT EXISTS evaluation_case_results_run_idx
  ON evaluation_case_results(evaluation_run_id, scenario, case_key);
