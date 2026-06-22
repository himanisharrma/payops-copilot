CREATE TABLE reconciliation_close_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  business_date DATE NOT NULL,
  provider_id TEXT NOT NULL
    CHECK (provider_id IN ('generic', 'razorpay_demo', 'cashfree_demo', 'payu_demo')),
  payment_mode TEXT NOT NULL,
  unresolved_count_threshold INTEGER NOT NULL DEFAULT 0
    CHECK (unresolved_count_threshold BETWEEN 0 AND 10000),
  unresolved_amount_threshold NUMERIC(14, 2) NOT NULL DEFAULT 0
    CHECK (unresolved_amount_threshold >= 0),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'submitted', 'approved', 'reopened')),
  active_version_id UUID,
  reopened_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reopened_by_name TEXT,
  reopened_reason TEXT,
  reopened_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, business_date, provider_id, payment_mode),
  UNIQUE (id, organization_id),
  CHECK (
    status <> 'reopened'
    OR (
      reopened_at IS NOT NULL
      AND LENGTH(BTRIM(COALESCE(reopened_by_name, ''))) > 0
      AND LENGTH(BTRIM(COALESCE(reopened_reason, ''))) >= 10
    )
  )
);

CREATE TABLE reconciliation_close_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_id UUID NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  snapshot JSONB NOT NULL CHECK (JSONB_TYPEOF(snapshot) = 'object'),
  snapshot_hash TEXT NOT NULL CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
  prepared_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  prepared_by_name TEXT NOT NULL,
  prepared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by_name TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (period_id, version_number),
  UNIQUE (id, organization_id),
  FOREIGN KEY (period_id, organization_id)
    REFERENCES reconciliation_close_periods(id, organization_id)
    ON DELETE CASCADE,
  CHECK (
    approved_at IS NULL
    OR (
      approved_by_user_id IS NOT NULL
      AND LENGTH(BTRIM(COALESCE(approved_by_name, ''))) > 0
      AND approved_by_user_id IS DISTINCT FROM prepared_by_user_id
    )
  )
);

ALTER TABLE reconciliation_close_periods
  ADD CONSTRAINT reconciliation_close_periods_active_version_fk
  FOREIGN KEY (active_version_id, organization_id)
  REFERENCES reconciliation_close_versions(id, organization_id);

CREATE TABLE reconciliation_close_dispositions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version_id UUID NOT NULL,
  case_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (LENGTH(BTRIM(reason)) BETWEEN 10 AND 2000),
  evidence_confirmed BOOLEAN NOT NULL CHECK (evidence_confirmed = TRUE),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (version_id, organization_id)
    REFERENCES reconciliation_close_versions(id, organization_id)
    ON DELETE CASCADE,
  FOREIGN KEY (case_id, organization_id)
    REFERENCES operations_cases(id, organization_id)
    ON DELETE RESTRICT,
  UNIQUE (version_id, case_id)
);

CREATE INDEX reconciliation_close_periods_queue_idx
  ON reconciliation_close_periods(
    organization_id,
    business_date DESC,
    status,
    provider_id,
    payment_mode
  );

CREATE INDEX reconciliation_close_versions_period_idx
  ON reconciliation_close_versions(
    organization_id,
    period_id,
    version_number DESC
  );

CREATE INDEX reconciliation_close_dispositions_case_idx
  ON reconciliation_close_dispositions(organization_id, case_id);
