CREATE TABLE source_ingestion_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL CHECK (LENGTH(BTRIM(source_key)) BETWEEN 4 AND 120),
  display_name TEXT NOT NULL CHECK (LENGTH(BTRIM(display_name)) BETWEEN 4 AND 180),
  provider_id TEXT NOT NULL
    CHECK (provider_id IN ('generic', 'razorpay_demo', 'cashfree_demo', 'payu_demo', 'paytm_demo', 'bank_demo', 'internal_ledger')),
  source_kind TEXT NOT NULL
    CHECK (source_kind IN ('internal_orders', 'gateway_report', 'settlement_statement', 'bank_statement', 'refunds_report', 'chargebacks_report')),
  transport_type TEXT NOT NULL DEFAULT 'manual_upload'
    CHECK (transport_type IN ('manual_upload', 'email_demo', 'sftp_demo', 'dashboard_export_demo', 'api_demo')),
  expected_frequency TEXT NOT NULL
    CHECK (expected_frequency IN ('daily', 'weekly', 'monthly', 'ad_hoc')),
  owner_team TEXT NOT NULL CHECK (LENGTH(BTRIM(owner_team)) BETWEEN 3 AND 120),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (JSONB_TYPEOF(evidence) = 'object'),
  seed_marker TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, source_key),
  UNIQUE (id, organization_id)
);

CREATE TABLE source_ingestion_expectations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_id UUID NOT NULL,
  business_date DATE NOT NULL,
  expected_arrival_at TIMESTAMPTZ NOT NULL,
  grace_minutes INTEGER NOT NULL DEFAULT 60 CHECK (grace_minutes BETWEEN 0 AND 2880),
  required_for_close BOOLEAN NOT NULL DEFAULT TRUE,
  expected_filename_pattern TEXT NOT NULL CHECK (LENGTH(BTRIM(expected_filename_pattern)) BETWEEN 3 AND 240),
  status TEXT NOT NULL DEFAULT 'expected'
    CHECK (status IN ('expected', 'arrived', 'late', 'missing', 'waived')),
  seed_marker TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, source_id, business_date),
  UNIQUE (id, organization_id),
  FOREIGN KEY (source_id, organization_id)
    REFERENCES source_ingestion_sources(id, organization_id)
    ON DELETE CASCADE
);

CREATE TABLE source_ingestion_arrivals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  expectation_id UUID NOT NULL,
  source_id UUID NOT NULL,
  file_name TEXT NOT NULL CHECK (LENGTH(BTRIM(file_name)) BETWEEN 3 AND 240),
  file_hash TEXT NOT NULL CHECK (file_hash ~ '^[a-f0-9]{64}$'),
  source_row_count INTEGER NOT NULL DEFAULT 0 CHECK (source_row_count >= 0),
  accepted_row_count INTEGER NOT NULL DEFAULT 0 CHECK (accepted_row_count >= 0),
  rejected_row_count INTEGER NOT NULL DEFAULT 0 CHECK (rejected_row_count >= 0),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  supersedes_arrival_id UUID,
  classification TEXT NOT NULL
    CHECK (classification IN ('on_time', 'late', 'duplicate', 'revised', 'partial', 'schema_failed', 'empty_file', 'hash_mismatch')),
  validation_status TEXT NOT NULL
    CHECK (validation_status IN ('accepted', 'needs_review', 'rejected')),
  downstream_workflow TEXT NOT NULL
    CHECK (downstream_workflow IN ('reconciliation', 'settlement_import', 'close_control', 'manual_review')),
  linked_reconciliation_run_id UUID,
  linked_settlement_import_id UUID,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (JSONB_TYPEOF(evidence) = 'object'),
  seed_marker TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, source_id, file_hash),
  UNIQUE (id, organization_id),
  FOREIGN KEY (expectation_id, organization_id)
    REFERENCES source_ingestion_expectations(id, organization_id)
    ON DELETE CASCADE,
  FOREIGN KEY (source_id, organization_id)
    REFERENCES source_ingestion_sources(id, organization_id)
    ON DELETE CASCADE,
  FOREIGN KEY (linked_reconciliation_run_id, organization_id)
    REFERENCES reconciliation_runs(id, organization_id),
  FOREIGN KEY (linked_settlement_import_id, organization_id)
    REFERENCES settlement_import_batches(id, organization_id),
  FOREIGN KEY (supersedes_arrival_id, organization_id)
    REFERENCES source_ingestion_arrivals(id, organization_id),
  CHECK (accepted_row_count + rejected_row_count <= source_row_count)
);

CREATE TABLE source_ingestion_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_id UUID,
  expectation_id UUID,
  arrival_id UUID,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('source_registered', 'expectation_scheduled', 'file_arrived', 'file_rejected', 'expectation_waived', 'control_refreshed')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (JSONB_TYPEOF(details) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (source_id, organization_id)
    REFERENCES source_ingestion_sources(id, organization_id)
    ON DELETE SET NULL,
  FOREIGN KEY (expectation_id, organization_id)
    REFERENCES source_ingestion_expectations(id, organization_id)
    ON DELETE SET NULL,
  FOREIGN KEY (arrival_id, organization_id)
    REFERENCES source_ingestion_arrivals(id, organization_id)
    ON DELETE SET NULL
);

CREATE INDEX source_ingestion_sources_org_idx
  ON source_ingestion_sources(organization_id, active, provider_id, source_kind);

CREATE INDEX source_ingestion_expectations_board_idx
  ON source_ingestion_expectations(organization_id, business_date DESC, status, expected_arrival_at);

CREATE INDEX source_ingestion_arrivals_board_idx
  ON source_ingestion_arrivals(organization_id, received_at DESC, classification, validation_status);

CREATE INDEX source_ingestion_events_timeline_idx
  ON source_ingestion_events(organization_id, created_at DESC);
