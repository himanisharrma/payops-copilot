CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'upload',
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('processing', 'completed', 'failed')),
  total_orders INTEGER NOT NULL,
  processed_value NUMERIC(14, 2) NOT NULL,
  matched_value NUMERIC(14, 2) NOT NULL,
  unmatched_value NUMERIC(14, 2) NOT NULL,
  matched_count INTEGER NOT NULL,
  exception_count INTEGER NOT NULL,
  match_rate NUMERIC(6, 2) NOT NULL,
  source_files JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reconciliation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL,
  gateway_reference TEXT NOT NULL,
  payment_mode TEXT NOT NULL,
  order_amount NUMERIC(14, 2) NOT NULL,
  gateway_amount NUMERIC(14, 2),
  settled_amount NUMERIC(14, 2),
  expected_net NUMERIC(14, 2),
  variance NUMERIC(14, 2) NOT NULL,
  reconciliation_status TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  summary TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reconciliation_items_run_idx
  ON reconciliation_items(run_id);
CREATE INDEX IF NOT EXISTS reconciliation_items_status_idx
  ON reconciliation_items(reconciliation_status);

CREATE TABLE IF NOT EXISTS operations_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL UNIQUE REFERENCES reconciliation_items(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
  case_status TEXT NOT NULL DEFAULT 'open'
    CHECK (case_status IN ('open', 'investigating', 'resolved')),
  priority TEXT NOT NULL
    CHECK (priority IN ('low', 'medium', 'high')),
  owner TEXT,
  notes TEXT NOT NULL DEFAULT '',
  due_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS operations_cases_status_idx
  ON operations_cases(case_status);
CREATE INDEX IF NOT EXISTS operations_cases_priority_idx
  ON operations_cases(priority);
