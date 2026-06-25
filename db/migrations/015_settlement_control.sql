ALTER TABLE reconciliation_items
  ADD COLUMN transaction_at TIMESTAMPTZ,
  ADD COLUMN transaction_timestamp_source TEXT,
  ADD COLUMN settlement_recorded_at TIMESTAMPTZ,
  ADD COLUMN settlement_cycle TEXT,
  ADD COLUMN expected_settlement_at TIMESTAMPTZ,
  ADD COLUMN settlement_policy_version TEXT,
  ADD COLUMN settlement_calendar_version TEXT,
  ADD COLUMN settlement_timing_evidence JSONB;

ALTER TABLE reconciliation_items
  ADD CONSTRAINT reconciliation_items_transaction_source_check
  CHECK (
    transaction_timestamp_source IS NULL
    OR transaction_timestamp_source IN (
      'gateway_capture',
      'order_created'
    )
  ),
  ADD CONSTRAINT reconciliation_items_settlement_cycle_check
  CHECK (
    settlement_cycle IS NULL
    OR settlement_cycle IN ('T+0', 'T+1', 'T+2')
  ),
  ADD CONSTRAINT reconciliation_items_settlement_policy_metadata_check
  CHECK (
    (
      expected_settlement_at IS NULL
      AND settlement_cycle IS NULL
      AND settlement_policy_version IS NULL
      AND settlement_calendar_version IS NULL
      AND settlement_timing_evidence IS NULL
    )
    OR (
      transaction_at IS NOT NULL
      AND transaction_timestamp_source IS NOT NULL
      AND expected_settlement_at IS NOT NULL
      AND settlement_cycle IS NOT NULL
      AND LENGTH(BTRIM(settlement_policy_version)) > 0
      AND LENGTH(BTRIM(settlement_calendar_version)) > 0
      AND settlement_timing_evidence IS NOT NULL
      AND JSONB_TYPEOF(settlement_timing_evidence) = 'object'
    )
  ),
  ADD CONSTRAINT reconciliation_items_expected_settlement_order_check
  CHECK (
    expected_settlement_at IS NULL
    OR transaction_at IS NULL
    OR expected_settlement_at >= transaction_at
  );

ALTER TABLE operations_cases
  ADD COLUMN case_origin TEXT NOT NULL DEFAULT 'reconciliation_exception';

ALTER TABLE operations_cases
  ADD CONSTRAINT operations_cases_origin_check
  CHECK (
    case_origin IN ('reconciliation_exception', 'settlement_overdue')
  );

CREATE INDEX reconciliation_items_settlement_deadline_idx
  ON reconciliation_items(
    organization_id,
    expected_settlement_at,
    reconciliation_status
  )
  WHERE reconciliation_status = 'missing_settlement';

CREATE INDEX reconciliation_items_settlement_provider_mode_idx
  ON reconciliation_items(
    organization_id,
    payment_mode,
    expected_settlement_at DESC
  );

CREATE INDEX operations_cases_settlement_origin_idx
  ON operations_cases(
    organization_id,
    case_origin,
    case_status,
    created_at DESC
  );
