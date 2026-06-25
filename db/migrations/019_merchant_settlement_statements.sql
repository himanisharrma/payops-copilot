CREATE TABLE merchant_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  merchant_reference TEXT NOT NULL CHECK (LENGTH(BTRIM(merchant_reference)) BETWEEN 3 AND 80),
  display_name TEXT NOT NULL CHECK (LENGTH(BTRIM(display_name)) BETWEEN 2 AND 160),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, merchant_reference),
  UNIQUE (id, organization_id)
);

CREATE TABLE merchant_settlement_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  merchant_account_id UUID NOT NULL,
  source_run_id UUID,
  statement_reference TEXT NOT NULL CHECK (LENGTH(BTRIM(statement_reference)) BETWEEN 6 AND 120),
  provider_id TEXT NOT NULL
    CHECK (provider_id IN ('generic', 'razorpay_demo', 'cashfree_demo', 'payu_demo')),
  payment_mode TEXT NOT NULL CHECK (LENGTH(BTRIM(payment_mode)) > 0),
  settlement_cycle TEXT NOT NULL CHECK (settlement_cycle IN ('T+0', 'T+1', 'T+2', 'manual')),
  status TEXT NOT NULL DEFAULT 'expected'
    CHECK (status IN (
      'expected',
      'scheduled',
      'sent',
      'credited',
      'held',
      'failed',
      'partially_credited'
    )),
  utr TEXT,
  expected_settlement_at TIMESTAMPTZ NOT NULL,
  actual_settlement_at TIMESTAMPTZ,
  gross_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (gross_amount >= 0),
  deduction_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (deduction_amount >= 0),
  net_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (net_amount >= 0),
  bank_credit_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (bank_credit_amount >= 0),
  variance_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  utr_match_status TEXT NOT NULL DEFAULT 'awaiting_credit'
    CHECK (utr_match_status IN (
      'matched',
      'missing_utr',
      'utr_not_found',
      'duplicate_utr',
      'amount_mismatch',
      'failed_payout',
      'held_settlement',
      'delayed_credit',
      'retry_exhausted',
      'awaiting_credit',
      'not_due'
    )),
  classification_evidence JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (JSONB_TYPEOF(classification_evidence) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, statement_reference),
  UNIQUE (id, organization_id),
  FOREIGN KEY (merchant_account_id, organization_id)
    REFERENCES merchant_accounts(id, organization_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (source_run_id, organization_id)
    REFERENCES reconciliation_runs(id, organization_id)
    ON DELETE RESTRICT,
  CHECK (deduction_amount <= gross_amount),
  CHECK (net_amount = gross_amount - deduction_amount),
  CHECK (
    utr IS NULL
    OR LENGTH(BTRIM(utr)) BETWEEN 4 AND 80
  )
);

CREATE TABLE merchant_settlement_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL,
  source_item_id UUID,
  source_run_id UUID,
  order_id TEXT NOT NULL CHECK (LENGTH(BTRIM(order_id)) > 0),
  gateway_reference TEXT NOT NULL CHECK (LENGTH(BTRIM(gateway_reference)) > 0),
  transaction_at TIMESTAMPTZ,
  payment_mode TEXT NOT NULL CHECK (LENGTH(BTRIM(payment_mode)) > 0),
  gross_amount NUMERIC(14, 2) NOT NULL CHECK (gross_amount >= 0),
  deduction_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (deduction_amount >= 0),
  net_amount NUMERIC(14, 2) NOT NULL CHECK (net_amount >= 0),
  line_status TEXT NOT NULL DEFAULT 'included'
    CHECK (line_status IN ('included', 'held', 'failed', 'reversed', 'adjusted')),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (JSONB_TYPEOF(evidence) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (batch_id, order_id, gateway_reference),
  UNIQUE (id, organization_id),
  FOREIGN KEY (batch_id, organization_id)
    REFERENCES merchant_settlement_batches(id, organization_id)
    ON DELETE CASCADE,
  FOREIGN KEY (source_item_id, source_run_id, organization_id)
    REFERENCES reconciliation_items(id, run_id, organization_id)
    ON DELETE RESTRICT
);

CREATE TABLE merchant_settlement_deductions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL,
  line_id UUID,
  deduction_type TEXT NOT NULL
    CHECK (deduction_type IN (
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
    )),
  direction TEXT NOT NULL DEFAULT 'current_settlement'
    CHECK (direction IN ('current_settlement', 'forward_deduction', 'release')),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  tax_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  description TEXT NOT NULL CHECK (LENGTH(BTRIM(description)) BETWEEN 3 AND 500),
  forward_applied BOOLEAN NOT NULL DEFAULT FALSE,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (JSONB_TYPEOF(evidence) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, organization_id),
  FOREIGN KEY (batch_id, organization_id)
    REFERENCES merchant_settlement_batches(id, organization_id)
    ON DELETE CASCADE,
  FOREIGN KEY (line_id, organization_id)
    REFERENCES merchant_settlement_lines(id, organization_id)
    ON DELETE CASCADE
);

CREATE TABLE merchant_settlement_bank_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_id UUID,
  utr TEXT NOT NULL CHECK (LENGTH(BTRIM(utr)) BETWEEN 4 AND 80),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  credited_at TIMESTAMPTZ NOT NULL,
  bank_reference TEXT NOT NULL CHECK (LENGTH(BTRIM(bank_reference)) BETWEEN 4 AND 120),
  match_status TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (match_status IN ('matched', 'unmatched', 'duplicate', 'amount_mismatch')),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (JSONB_TYPEOF(evidence) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, organization_id),
  FOREIGN KEY (batch_id, organization_id)
    REFERENCES merchant_settlement_batches(id, organization_id)
    ON DELETE CASCADE
);

CREATE TABLE merchant_settlement_case_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL,
  line_id UUID,
  case_id UUID NOT NULL,
  link_type TEXT NOT NULL
    CHECK (link_type IN ('utr_exception', 'amount_exception', 'settlement_delay', 'manual_review')),
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (batch_id, case_id),
  FOREIGN KEY (batch_id, organization_id)
    REFERENCES merchant_settlement_batches(id, organization_id)
    ON DELETE CASCADE,
  FOREIGN KEY (line_id, organization_id)
    REFERENCES merchant_settlement_lines(id, organization_id)
    ON DELETE CASCADE,
  FOREIGN KEY (case_id, organization_id)
    REFERENCES operations_cases(id, organization_id)
    ON DELETE RESTRICT
);

CREATE TABLE merchant_settlement_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL,
  actor_user_id UUID,
  actor_name TEXT NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('batch_refreshed', 'classification_updated', 'case_linked')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (JSONB_TYPEOF(details) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (batch_id, organization_id)
    REFERENCES merchant_settlement_batches(id, organization_id)
    ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id, organization_id)
    REFERENCES users(id, organization_id)
    ON DELETE RESTRICT
);

CREATE INDEX merchant_accounts_org_status_idx
  ON merchant_accounts(organization_id, status, display_name);

CREATE INDEX merchant_settlement_batches_list_idx
  ON merchant_settlement_batches(
    organization_id,
    expected_settlement_at DESC,
    status,
    provider_id,
    payment_mode
  );

CREATE INDEX merchant_settlement_batches_utr_idx
  ON merchant_settlement_batches(organization_id, utr)
  WHERE utr IS NOT NULL;

CREATE INDEX merchant_settlement_lines_batch_idx
  ON merchant_settlement_lines(organization_id, batch_id, created_at);

CREATE INDEX merchant_settlement_deductions_batch_idx
  ON merchant_settlement_deductions(organization_id, batch_id, deduction_type);

CREATE INDEX merchant_settlement_bank_credits_utr_idx
  ON merchant_settlement_bank_credits(organization_id, utr, credited_at DESC);

CREATE INDEX merchant_settlement_case_links_case_idx
  ON merchant_settlement_case_links(organization_id, case_id, linked_at DESC);

CREATE INDEX merchant_settlement_events_timeline_idx
  ON merchant_settlement_events(organization_id, batch_id, created_at DESC);
