CREATE TABLE IF NOT EXISTS payment_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workflow_type TEXT NOT NULL CHECK (workflow_type IN ('refund', 'chargeback')),
  external_reference TEXT NOT NULL,
  order_id TEXT NOT NULL,
  payment_reference TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  owner TEXT,
  due_at TIMESTAMPTZ NOT NULL,
  evidence_checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT NOT NULL DEFAULT '',
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, external_reference)
);

CREATE INDEX IF NOT EXISTS payment_workflows_queue_idx
  ON payment_workflows(organization_id, workflow_type, status, due_at);

CREATE TABLE IF NOT EXISTS payment_workflow_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES payment_workflows(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  actor_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payment_workflow_events_timeline_idx
  ON payment_workflow_events(workflow_id, created_at DESC);

WITH organization AS (
  SELECT id FROM organizations WHERE slug = 'payops-portfolio'
)
INSERT INTO payment_workflows (
  organization_id, workflow_type, external_reference, order_id,
  payment_reference, amount, reason, status, priority, owner, due_at,
  evidence_checklist, notes, resolved_at, created_at
)
SELECT id, workflow_type, external_reference, order_id, payment_reference,
  amount, reason, status, priority, owner, due_at, evidence_checklist::jsonb,
  notes, resolved_at, created_at
FROM organization
CROSS JOIN (
  VALUES
    ('refund', 'RF-2026-1042', 'ORD-1042', 'PAY-UPI-1042', 2499.00,
     'Customer charged after merchant cancellation', 'approved', 'high',
     'Asha Analyst', NOW() + INTERVAL '2 hours',
     '[{"key":"request","label":"Customer request captured","complete":true},{"key":"merchant","label":"Merchant cancellation confirmed","complete":true},{"key":"ledger","label":"Ledger impact verified","complete":false},{"key":"approval","label":"Maker-checker approval recorded","complete":true}]',
     'Waiting for ledger verification before processing.', NULL, NOW() - INTERVAL '3 hours'),
    ('refund', 'RF-2026-1037', 'ORD-1037', 'PAY-CARD-1037', 899.00,
     'Duplicate capture confirmed by gateway', 'processing', 'medium',
     'Asha Analyst', NOW() + INTERVAL '18 hours',
     '[{"key":"request","label":"Customer request captured","complete":true},{"key":"duplicate","label":"Duplicate transaction verified","complete":true},{"key":"approval","label":"Refund approval recorded","complete":true},{"key":"provider","label":"Provider acknowledgement received","complete":false}]',
     'Gateway refund reference requested.', NULL, NOW() - INTERVAL '8 hours'),
    ('refund', 'RF-2026-1018', 'ORD-1018', 'PAY-NB-1018', 1299.00,
     'Service not delivered', 'completed', 'low',
     'Asha Analyst', NOW() - INTERVAL '18 hours',
     '[{"key":"request","label":"Customer request captured","complete":true},{"key":"merchant","label":"Merchant confirmation received","complete":true},{"key":"approval","label":"Refund approval recorded","complete":true},{"key":"provider","label":"Provider refund reference stored","complete":true}]',
     'Refund completed and reference shared.', NOW() - INTERVAL '22 hours', NOW() - INTERVAL '3 days'),
    ('chargeback', 'CB-2026-0088', 'ORD-0988', 'PAY-CARD-0988', 12450.00,
     'Cardholder claims transaction not recognized', 'evidence_due', 'high',
     'Asha Analyst', NOW() + INTERVAL '5 hours',
     '[{"key":"order","label":"Order and invoice attached","complete":true},{"key":"delivery","label":"Delivery proof attached","complete":false},{"key":"authentication","label":"Authentication evidence attached","complete":true},{"key":"response","label":"Issuer response drafted","complete":false}]',
     'Delivery proof requested from merchant.', NULL, NOW() - INTERVAL '19 hours'),
    ('chargeback', 'CB-2026-0082', 'ORD-0964', 'PAY-CARD-0964', 5750.00,
     'Product not received', 'evidence_submitted', 'medium',
     'Himani Admin', NOW() + INTERVAL '2 days',
     '[{"key":"order","label":"Order and invoice attached","complete":true},{"key":"delivery","label":"Delivery proof attached","complete":true},{"key":"communication","label":"Customer communication attached","complete":true},{"key":"response","label":"Issuer response submitted","complete":true}]',
     'Representment submitted; awaiting issuer decision.', NULL, NOW() - INTERVAL '4 days'),
    ('chargeback', 'CB-2026-0069', 'ORD-0912', 'PAY-CARD-0912', 3200.00,
     'Duplicate processing dispute', 'won', 'low',
     'Himani Admin', NOW() - INTERVAL '1 day',
     '[{"key":"order","label":"Order record attached","complete":true},{"key":"gateway","label":"Gateway trace attached","complete":true},{"key":"settlement","label":"Settlement evidence attached","complete":true},{"key":"response","label":"Issuer response submitted","complete":true}]',
     'Issuer reversed the chargeback after evidence review.', NOW() - INTERVAL '2 days', NOW() - INTERVAL '9 days')
) AS seed(
  workflow_type, external_reference, order_id, payment_reference, amount,
  reason, status, priority, owner, due_at, evidence_checklist, notes,
  resolved_at, created_at
)
ON CONFLICT (organization_id, external_reference) DO NOTHING;

INSERT INTO payment_workflow_events (
  workflow_id, event_type, title, detail, actor_name, created_at
)
SELECT workflow.id, 'created', 'Workflow opened',
  CASE
    WHEN workflow.workflow_type = 'refund'
      THEN 'Refund request entered into the operations queue.'
    ELSE 'Chargeback notification entered into the evidence queue.'
  END,
  'Demo seed', workflow.created_at
FROM payment_workflows workflow
WHERE NOT EXISTS (
  SELECT 1 FROM payment_workflow_events event
  WHERE event.workflow_id = workflow.id
);
