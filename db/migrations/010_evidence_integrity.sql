ALTER TABLE reconciliation_items
  ADD COLUMN organization_id UUID;

UPDATE reconciliation_items item
SET organization_id = run.organization_id
FROM reconciliation_runs run
WHERE run.id = item.run_id
  AND item.organization_id IS NULL;

ALTER TABLE reconciliation_items
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE reconciliation_items
  ADD CONSTRAINT reconciliation_items_organization_fk
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE reconciliation_runs
  ADD CONSTRAINT reconciliation_runs_id_organization_unique
  UNIQUE (id, organization_id);

ALTER TABLE reconciliation_items
  ADD CONSTRAINT reconciliation_items_id_organization_unique
  UNIQUE (id, organization_id);

ALTER TABLE reconciliation_items
  ADD CONSTRAINT reconciliation_items_identity_unique
  UNIQUE (id, run_id, organization_id);

ALTER TABLE reconciliation_items
  ADD CONSTRAINT reconciliation_items_run_organization_fk
  FOREIGN KEY (run_id, organization_id)
  REFERENCES reconciliation_runs(id, organization_id)
  ON DELETE CASCADE;

ALTER TABLE operations_cases
  ADD CONSTRAINT operations_cases_run_organization_fk
  FOREIGN KEY (run_id, organization_id)
  REFERENCES reconciliation_runs(id, organization_id)
  ON DELETE CASCADE;

ALTER TABLE operations_cases
  ADD CONSTRAINT operations_cases_item_run_organization_fk
  FOREIGN KEY (item_id, run_id, organization_id)
  REFERENCES reconciliation_items(id, run_id, organization_id)
  ON DELETE CASCADE;

CREATE INDEX reconciliation_items_organization_run_idx
  ON reconciliation_items(organization_id, run_id);

CREATE TABLE reconciliation_source_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id UUID NOT NULL,
  item_id UUID NOT NULL,
  source_type TEXT NOT NULL
    CHECK (source_type IN ('orders', 'gateway', 'settlements')),
  row_number INTEGER NOT NULL CHECK (row_number > 0),
  normalized_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  integrity_hash TEXT NOT NULL CHECK (integrity_hash ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (item_id, run_id, organization_id)
    REFERENCES reconciliation_items(id, run_id, organization_id)
    ON DELETE CASCADE,
  UNIQUE (item_id, source_type, row_number)
);

CREATE INDEX reconciliation_source_evidence_case_idx
  ON reconciliation_source_evidence(organization_id, item_id, source_type);

ALTER TABLE operations_cases
  ADD COLUMN resolution_reason TEXT,
  ADD COLUMN resolution_evidence_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN resolved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN resolved_by_name TEXT;

UPDATE operations_cases
SET resolution_reason = 'Resolved before the evidence-ledger release.',
    resolution_evidence_confirmed = TRUE,
    resolved_by_name = 'Historical record'
WHERE case_status = 'resolved';

ALTER TABLE operations_cases
  ADD CONSTRAINT operations_cases_resolution_metadata_check
  CHECK (
    case_status <> 'resolved'
    OR (
      resolved_at IS NOT NULL
      AND LENGTH(BTRIM(COALESCE(resolution_reason, ''))) >= 10
      AND resolution_evidence_confirmed = TRUE
      AND LENGTH(BTRIM(COALESCE(resolved_by_name, ''))) > 0
    )
  );
