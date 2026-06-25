ALTER TABLE reconciliation_runs
  ADD COLUMN provider_id TEXT;

UPDATE reconciliation_runs
SET provider_id = 'generic'
WHERE provider_id IS NULL;

ALTER TABLE reconciliation_runs
  ALTER COLUMN provider_id SET DEFAULT 'generic',
  ALTER COLUMN provider_id SET NOT NULL;

ALTER TABLE reconciliation_runs
  ADD CONSTRAINT reconciliation_runs_provider_check
  CHECK (provider_id IN (
    'generic', 'razorpay_demo', 'cashfree_demo', 'payu_demo'
  ));

CREATE INDEX reconciliation_runs_insights_idx
  ON reconciliation_runs(organization_id, provider_id, created_at DESC);

CREATE INDEX reconciliation_items_insights_idx
  ON reconciliation_items(
    organization_id, payment_mode, reconciliation_status, created_at DESC
  );

CREATE INDEX operations_cases_insights_idx
  ON operations_cases(
    organization_id, priority, case_status, created_at DESC, resolved_at
  );
