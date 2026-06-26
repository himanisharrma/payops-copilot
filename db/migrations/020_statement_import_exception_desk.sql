CREATE TABLE settlement_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL
    CHECK (provider_id IN ('generic', 'razorpay_demo', 'cashfree_demo', 'payu_demo')),
  import_reference TEXT NOT NULL CHECK (LENGTH(BTRIM(import_reference)) BETWEEN 6 AND 140),
  source_filename TEXT NOT NULL CHECK (LENGTH(BTRIM(source_filename)) BETWEEN 3 AND 240),
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL DEFAULT 'staged'
    CHECK (status IN ('staged', 'compared', 'needs_review', 'closed')),
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  exception_count INTEGER NOT NULL DEFAULT 0 CHECK (exception_count >= 0),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (JSONB_TYPEOF(evidence) = 'object'),
  seed_marker TEXT,
  imported_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  imported_by_name TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, provider_id, source_hash),
  UNIQUE (id, organization_id)
);

CREATE TABLE settlement_import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  import_batch_id UUID NOT NULL,
  row_number INTEGER NOT NULL CHECK (row_number > 0),
  row_fingerprint TEXT NOT NULL CHECK (row_fingerprint ~ '^[a-f0-9]{64}$'),
  statement_reference TEXT NOT NULL CHECK (LENGTH(BTRIM(statement_reference)) > 0),
  merchant_reference TEXT NOT NULL CHECK (LENGTH(BTRIM(merchant_reference)) > 0),
  order_id TEXT NOT NULL CHECK (LENGTH(BTRIM(order_id)) > 0),
  gateway_reference TEXT NOT NULL CHECK (LENGTH(BTRIM(gateway_reference)) > 0),
  payment_mode TEXT NOT NULL CHECK (LENGTH(BTRIM(payment_mode)) > 0),
  gross_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (gross_amount >= 0),
  deduction_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (deduction_amount >= 0),
  net_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (net_amount >= 0),
  deduction_type TEXT
    CHECK (
      deduction_type IS NULL
      OR deduction_type IN (
        'mdr',
        'commission',
        'gst',
        'refund',
        'chargeback',
        'recovery',
        'adjustment',
        'rental',
        'subscription',
        'hold',
        'hold_release',
        'rounding'
      )
    ),
  utr TEXT,
  bank_reference TEXT,
  settlement_status TEXT NOT NULL DEFAULT 'credited'
    CHECK (settlement_status IN (
      'expected',
      'scheduled',
      'sent',
      'credited',
      'held',
      'failed',
      'partially_credited'
    )),
  expected_settlement_at TIMESTAMPTZ,
  actual_settlement_at TIMESTAMPTZ,
  raw_values JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (JSONB_TYPEOF(raw_values) = 'object'),
  normalized_values JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (JSONB_TYPEOF(normalized_values) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, import_batch_id, row_fingerprint),
  UNIQUE (id, organization_id),
  FOREIGN KEY (import_batch_id, organization_id)
    REFERENCES settlement_import_batches(id, organization_id)
    ON DELETE CASCADE,
  CHECK (deduction_amount <= gross_amount),
  CHECK (net_amount = gross_amount - deduction_amount)
);

CREATE TABLE settlement_import_comparisons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  import_batch_id UUID NOT NULL,
  import_row_id UUID NOT NULL,
  settlement_batch_id UUID,
  settlement_line_id UUID,
  bank_credit_id UUID,
  operations_case_id UUID,
  comparison_status TEXT NOT NULL
    CHECK (comparison_status IN ('matched', 'exception')),
  exception_type TEXT
    CHECK (
      exception_type IS NULL
      OR exception_type IN (
        'missing_utr',
        'utr_not_found',
        'duplicate_utr',
        'amount_mismatch',
        'failed_payout',
        'held_settlement',
        'delayed_credit',
        'retry_exhausted',
        'deduction_mismatch',
        'unexplained_hold',
        'forward_deduction_mismatch'
      )
    ),
  amount_variance NUMERIC(14, 2) NOT NULL DEFAULT 0,
  deduction_variance NUMERIC(14, 2) NOT NULL DEFAULT 0,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (JSONB_TYPEOF(evidence) = 'object'),
  compared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, import_row_id),
  UNIQUE (id, organization_id),
  FOREIGN KEY (import_batch_id, organization_id)
    REFERENCES settlement_import_batches(id, organization_id)
    ON DELETE CASCADE,
  FOREIGN KEY (import_row_id, organization_id)
    REFERENCES settlement_import_rows(id, organization_id)
    ON DELETE CASCADE,
  FOREIGN KEY (settlement_batch_id, organization_id)
    REFERENCES merchant_settlement_batches(id, organization_id),
  FOREIGN KEY (settlement_line_id, organization_id)
    REFERENCES merchant_settlement_lines(id, organization_id),
  FOREIGN KEY (bank_credit_id, organization_id)
    REFERENCES merchant_settlement_bank_credits(id, organization_id),
  FOREIGN KEY (operations_case_id, organization_id)
    REFERENCES operations_cases(id, organization_id),
  CHECK (
    (comparison_status = 'matched' AND exception_type IS NULL)
    OR (comparison_status = 'exception' AND exception_type IS NOT NULL)
  )
);

CREATE TABLE settlement_import_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  import_batch_id UUID NOT NULL,
  comparison_id UUID NOT NULL,
  import_row_id UUID NOT NULL,
  settlement_batch_id UUID,
  operations_case_id UUID,
  exception_type TEXT NOT NULL
    CHECK (exception_type IN (
      'missing_utr',
      'utr_not_found',
      'duplicate_utr',
      'amount_mismatch',
      'failed_payout',
      'held_settlement',
      'delayed_credit',
      'retry_exhausted',
      'deduction_mismatch',
      'unexplained_hold',
      'forward_deduction_mismatch'
    )),
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'adjustment_proposed', 'resolved')),
  exposure_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (exposure_amount >= 0),
  summary TEXT NOT NULL CHECK (LENGTH(BTRIM(summary)) BETWEEN 10 AND 700),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (JSONB_TYPEOF(evidence) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, comparison_id),
  UNIQUE (id, organization_id),
  FOREIGN KEY (import_batch_id, organization_id)
    REFERENCES settlement_import_batches(id, organization_id)
    ON DELETE CASCADE,
  FOREIGN KEY (comparison_id, organization_id)
    REFERENCES settlement_import_comparisons(id, organization_id)
    ON DELETE CASCADE,
  FOREIGN KEY (import_row_id, organization_id)
    REFERENCES settlement_import_rows(id, organization_id)
    ON DELETE CASCADE,
  FOREIGN KEY (settlement_batch_id, organization_id)
    REFERENCES merchant_settlement_batches(id, organization_id),
  FOREIGN KEY (operations_case_id, organization_id)
    REFERENCES operations_cases(id, organization_id)
);

CREATE TABLE settlement_adjustment_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  exception_id UUID NOT NULL,
  adjustment_type TEXT NOT NULL
    CHECK (adjustment_type IN ('credit_note', 'debit_note', 'hold_release', 'write_off', 'manual_review')),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  reason TEXT NOT NULL CHECK (LENGTH(BTRIM(reason)) BETWEEN 10 AND 2000),
  evidence_reference TEXT NOT NULL CHECK (LENGTH(BTRIM(evidence_reference)) BETWEEN 4 AND 200),
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'approved', 'rejected', 'withdrawn')),
  proposed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  proposed_by_name TEXT NOT NULL,
  decided_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_by_name TEXT,
  decision_reason TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, organization_id),
  FOREIGN KEY (exception_id, organization_id)
    REFERENCES settlement_import_exceptions(id, organization_id)
    ON DELETE CASCADE,
  CHECK (
    status NOT IN ('approved', 'rejected')
    OR (
      decided_at IS NOT NULL
      AND LENGTH(BTRIM(COALESCE(decided_by_name, ''))) > 0
      AND LENGTH(BTRIM(COALESCE(decision_reason, ''))) >= 10
    )
  )
);

CREATE TABLE settlement_adjustment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  adjustment_id UUID NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('proposed', 'approved', 'rejected', 'withdrawn')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (JSONB_TYPEOF(details) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (adjustment_id, organization_id)
    REFERENCES settlement_adjustment_proposals(id, organization_id)
    ON DELETE CASCADE
);

CREATE TABLE settlement_evidence_packets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  import_batch_id UUID NOT NULL,
  packet_reference TEXT NOT NULL CHECK (LENGTH(BTRIM(packet_reference)) BETWEEN 6 AND 140),
  generated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  generated_by_name TEXT NOT NULL,
  packet_hash TEXT NOT NULL CHECK (packet_hash ~ '^[a-f0-9]{64}$'),
  format TEXT NOT NULL DEFAULT 'json' CHECK (format IN ('json')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (JSONB_TYPEOF(metadata) = 'object'),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, packet_reference),
  FOREIGN KEY (import_batch_id, organization_id)
    REFERENCES settlement_import_batches(id, organization_id)
    ON DELETE CASCADE
);

CREATE INDEX settlement_import_batches_list_idx
  ON settlement_import_batches(organization_id, imported_at DESC, provider_id, status);

CREATE INDEX settlement_import_rows_batch_idx
  ON settlement_import_rows(organization_id, import_batch_id, row_number);

CREATE INDEX settlement_import_rows_match_idx
  ON settlement_import_rows(organization_id, statement_reference, gateway_reference, order_id, utr);

CREATE INDEX settlement_import_comparisons_batch_idx
  ON settlement_import_comparisons(organization_id, import_batch_id, comparison_status, exception_type);

CREATE INDEX settlement_import_exceptions_queue_idx
  ON settlement_import_exceptions(organization_id, status, exception_type, priority, created_at DESC);

CREATE INDEX settlement_adjustment_proposals_exception_idx
  ON settlement_adjustment_proposals(organization_id, exception_id, status, created_at DESC);

CREATE INDEX settlement_adjustment_events_timeline_idx
  ON settlement_adjustment_events(organization_id, adjustment_id, created_at DESC);
