CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO organizations (name, slug)
VALUES ('PayOps Portfolio', 'payops-portfolio')
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'analyst', 'viewer')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE reconciliation_runs ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE operations_cases ADD COLUMN IF NOT EXISTS organization_id UUID;

UPDATE reconciliation_runs
SET organization_id = (SELECT id FROM organizations WHERE slug = 'payops-portfolio')
WHERE organization_id IS NULL;

UPDATE operations_cases
SET organization_id = (SELECT id FROM organizations WHERE slug = 'payops-portfolio')
WHERE organization_id IS NULL;

ALTER TABLE reconciliation_runs ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE operations_cases ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE reconciliation_runs
  ADD CONSTRAINT reconciliation_runs_organization_fk
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE operations_cases
  ADD CONSTRAINT operations_cases_organization_fk
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS reconciliation_runs_organization_idx
  ON reconciliation_runs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS operations_cases_organization_idx
  ON operations_cases(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_events_organization_idx
  ON audit_events(organization_id, created_at DESC);
