UPDATE operations_cases
SET due_at = created_at + CASE priority
  WHEN 'high' THEN INTERVAL '4 hours'
  WHEN 'medium' THEN INTERVAL '24 hours'
  ELSE INTERVAL '72 hours'
END
WHERE due_at IS NULL;

ALTER TABLE operations_cases ALTER COLUMN due_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS operations_cases_sla_idx
  ON operations_cases(organization_id, case_status, due_at);
