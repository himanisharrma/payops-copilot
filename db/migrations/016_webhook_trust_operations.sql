ALTER TABLE provider_webhook_deliveries
  ADD COLUMN signature_version TEXT NOT NULL DEFAULT 'legacy-v1',
  ADD COLUMN signature_key_id TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE provider_webhook_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL
    CHECK (provider_id IN ('razorpay_demo', 'cashfree_demo', 'payu_demo')),
  external_event_id TEXT NOT NULL,
  event_type TEXT,
  payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  signature_version TEXT NOT NULL,
  signature_key_id TEXT,
  key_state TEXT CHECK (key_state IN ('active', 'previous')),
  outcome TEXT NOT NULL CHECK (
    outcome IN ('accepted', 'duplicate', 'rejected', 'conflict', 'failed')
  ),
  http_status INTEGER NOT NULL CHECK (http_status BETWEEN 100 AND 599),
  failure_code TEXT,
  matched_records INTEGER NOT NULL DEFAULT 0 CHECK (matched_records >= 0),
  provider_event_id UUID REFERENCES provider_events(id) ON DELETE SET NULL,
  processing_ms INTEGER NOT NULL CHECK (processing_ms >= 0),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX provider_webhook_attempts_tenant_time_idx
  ON provider_webhook_attempts(
    organization_id, received_at DESC, provider_id, outcome
  );

CREATE INDEX provider_webhook_attempts_key_idx
  ON provider_webhook_attempts(
    organization_id, provider_id, signature_key_id, received_at DESC
  );
