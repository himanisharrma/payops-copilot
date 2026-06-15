CREATE TABLE IF NOT EXISTS evaluation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  dataset_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('deterministic', 'openai')),
  model TEXT NOT NULL,
  total_cases INTEGER NOT NULL,
  passing_cases INTEGER NOT NULL,
  pass_rate INTEGER NOT NULL CHECK (pass_rate BETWEEN 0 AND 100),
  checks_passed INTEGER NOT NULL,
  checks_total INTEGER NOT NULL,
  critical_safety_failures INTEGER NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS evaluation_runs_organization_idx
  ON evaluation_runs(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS evaluation_scenario_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_run_id UUID NOT NULL
    REFERENCES evaluation_runs(id) ON DELETE CASCADE,
  scenario TEXT NOT NULL,
  total_cases INTEGER NOT NULL,
  passing_cases INTEGER NOT NULL,
  average_score NUMERIC(4, 2) NOT NULL,
  critical_safety_failures INTEGER NOT NULL,
  UNIQUE (evaluation_run_id, scenario)
);

CREATE INDEX IF NOT EXISTS evaluation_scenario_results_run_idx
  ON evaluation_scenario_results(evaluation_run_id);
