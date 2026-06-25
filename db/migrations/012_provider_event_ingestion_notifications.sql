CREATE TABLE IF NOT EXISTS provider_webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL
    CHECK (provider_id IN ('razorpay_demo', 'cashfree_demo', 'payu_demo')),
  external_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, provider_id, external_event_id)
);

CREATE INDEX IF NOT EXISTS provider_webhook_deliveries_tenant_idx
  ON provider_webhook_deliveries(organization_id, received_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS provider_webhook_deliveries_id_tenant_uidx
  ON provider_webhook_deliveries(id, organization_id);

CREATE TABLE IF NOT EXISTS provider_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  delivery_id UUID NOT NULL UNIQUE
    REFERENCES provider_webhook_deliveries(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL
    CHECK (provider_id IN ('razorpay_demo', 'cashfree_demo', 'payu_demo')),
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  order_id TEXT,
  payment_reference TEXT,
  external_reference TEXT,
  amount NUMERIC(14, 2),
  status TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  proves TEXT NOT NULL,
  does_not_prove TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT provider_events_delivery_tenant_fk
    FOREIGN KEY (delivery_id, organization_id)
    REFERENCES provider_webhook_deliveries(id, organization_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS provider_events_tenant_lookup_idx
  ON provider_events(
    organization_id,
    order_id,
    payment_reference,
    external_reference,
    occurred_at
  );

CREATE TABLE IF NOT EXISTS operational_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL
    CHECK (notification_type IN ('provider_event', 'sla_at_risk', 'sla_overdue')),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  entity_type TEXT CHECK (entity_type IN ('operations_case', 'payment_workflow')),
  entity_id UUID,
  dedupe_key TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  read_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS operational_notifications_inbox_idx
  ON operational_notifications(organization_id, read_at, created_at DESC);
