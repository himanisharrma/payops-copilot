ALTER TABLE users
  ADD CONSTRAINT users_id_organization_unique
  UNIQUE (id, organization_id);

CREATE TABLE remediation_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  provider_id TEXT NOT NULL
    CHECK (provider_id IN ('generic', 'razorpay_demo', 'cashfree_demo', 'payu_demo')),
  payment_mode TEXT NOT NULL,
  reconciliation_status TEXT NOT NULL
    CHECK (reconciliation_status IN (
      'amount_mismatch', 'missing_settlement', 'gateway_missing', 'duplicate'
    )),
  case_origin TEXT NOT NULL
    CHECK (case_origin IN ('reconciliation_exception', 'settlement_overdue')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'monitoring', 'verified', 'abandoned')),
  owner_user_id UUID,
  owner_name TEXT NOT NULL,
  remediation_plan TEXT NOT NULL
    CHECK (LENGTH(BTRIM(remediation_plan)) BETWEEN 20 AND 4000),
  target_date DATE NOT NULL,
  detection_window_start TIMESTAMPTZ NOT NULL,
  detection_window_end TIMESTAMPTZ NOT NULL,
  baseline_case_count INTEGER NOT NULL CHECK (baseline_case_count >= 3),
  baseline_exposure NUMERIC(14, 2) NOT NULL CHECK (baseline_exposure >= 0),
  implementation_summary TEXT,
  implementation_evidence_reference TEXT,
  implemented_at TIMESTAMPTZ,
  verified_by_user_id UUID,
  verified_by_name TEXT,
  verified_at TIMESTAMPTZ,
  abandoned_by_user_id UUID,
  abandoned_by_name TEXT,
  abandoned_reason TEXT,
  abandoned_at TIMESTAMPTZ,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, organization_id),
  FOREIGN KEY (owner_user_id, organization_id)
    REFERENCES users(id, organization_id),
  FOREIGN KEY (verified_by_user_id, organization_id)
    REFERENCES users(id, organization_id),
  FOREIGN KEY (abandoned_by_user_id, organization_id)
    REFERENCES users(id, organization_id),
  CHECK (detection_window_end > detection_window_start),
  CHECK (
    status <> 'monitoring'
    OR (
      implemented_at IS NOT NULL
      AND LENGTH(BTRIM(COALESCE(implementation_summary, ''))) >= 20
      AND LENGTH(BTRIM(COALESCE(implementation_evidence_reference, ''))) >= 5
    )
  ),
  CHECK (
    status <> 'verified'
    OR (
      implemented_at IS NOT NULL
      AND verified_at IS NOT NULL
      AND verified_by_user_id IS NOT NULL
      AND LENGTH(BTRIM(COALESCE(verified_by_name, ''))) > 0
    )
  ),
  CHECK (
    status <> 'abandoned'
    OR (
      abandoned_at IS NOT NULL
      AND abandoned_by_user_id IS NOT NULL
      AND LENGTH(BTRIM(COALESCE(abandoned_by_name, ''))) > 0
      AND LENGTH(BTRIM(COALESCE(abandoned_reason, ''))) >= 10
    )
  )
);

CREATE UNIQUE INDEX remediation_programs_open_fingerprint_uidx
  ON remediation_programs(organization_id, fingerprint)
  WHERE status IN ('active', 'monitoring');

CREATE INDEX remediation_programs_queue_idx
  ON remediation_programs(organization_id, status, target_date, updated_at DESC);

CREATE TABLE remediation_program_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  program_id UUID NOT NULL,
  case_id UUID NOT NULL,
  link_type TEXT NOT NULL CHECK (link_type IN ('baseline', 'automatic')),
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (program_id, organization_id)
    REFERENCES remediation_programs(id, organization_id)
    ON DELETE CASCADE,
  FOREIGN KEY (case_id, organization_id)
    REFERENCES operations_cases(id, organization_id)
    ON DELETE RESTRICT,
  UNIQUE (program_id, case_id)
);

CREATE INDEX remediation_program_cases_case_idx
  ON remediation_program_cases(organization_id, case_id, linked_at DESC);

CREATE TABLE remediation_program_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  program_id UUID NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'program_created',
    'program_updated',
    'case_linked',
    'implementation_started',
    'program_verified',
    'program_abandoned'
  )),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (program_id, organization_id)
    REFERENCES remediation_programs(id, organization_id)
    ON DELETE CASCADE
);

CREATE INDEX remediation_program_events_timeline_idx
  ON remediation_program_events(organization_id, program_id, created_at DESC);
