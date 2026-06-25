ALTER TABLE operations_cases
  ADD CONSTRAINT operations_cases_id_organization_unique
  UNIQUE (id, organization_id);

CREATE TABLE operations_case_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id UUID NOT NULL,
  author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL CHECK (
    LENGTH(BTRIM(body)) BETWEEN 1 AND 2000
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (case_id, organization_id)
    REFERENCES operations_cases(id, organization_id)
    ON DELETE CASCADE
);

CREATE INDEX operations_case_comments_case_idx
  ON operations_case_comments(organization_id, case_id, created_at DESC);

CREATE INDEX operations_cases_owner_queue_idx
  ON operations_cases(organization_id, owner, case_status, due_at);
