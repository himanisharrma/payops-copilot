ALTER TABLE source_ingestion_arrivals
  ADD COLUMN reviewed_at TIMESTAMPTZ,
  ADD COLUMN reviewed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN reviewed_by_name TEXT,
  ADD COLUMN review_reason TEXT;

ALTER TABLE source_ingestion_arrivals
  ADD CONSTRAINT source_ingestion_arrival_review_check CHECK (
    (reviewed_at IS NULL AND reviewed_by_name IS NULL AND review_reason IS NULL)
    OR
    (reviewed_at IS NOT NULL
      AND LENGTH(BTRIM(reviewed_by_name)) BETWEEN 2 AND 180
      AND LENGTH(BTRIM(review_reason)) BETWEEN 3 AND 1000)
  );

ALTER TABLE source_ingestion_events
  DROP CONSTRAINT source_ingestion_events_event_type_check;

ALTER TABLE source_ingestion_events
  ADD CONSTRAINT source_ingestion_events_event_type_check CHECK (
    event_type IN (
      'source_registered', 'expectation_scheduled', 'file_arrived',
      'file_accepted', 'file_rejected', 'expectation_waived',
      'control_refreshed', 'readiness_snapshotted'
    )
  );

CREATE TABLE source_ingestion_readiness_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  business_date DATE NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('ready', 'blocked')),
  expected_files INTEGER NOT NULL CHECK (expected_files >= 0),
  accepted_files INTEGER NOT NULL CHECK (accepted_files >= 0),
  missing_files INTEGER NOT NULL CHECK (missing_files >= 0),
  late_files INTEGER NOT NULL CHECK (late_files >= 0),
  quarantined_files INTEGER NOT NULL CHECK (quarantined_files >= 0),
  blocking_files INTEGER NOT NULL CHECK (blocking_files >= 0),
  optional_warnings INTEGER NOT NULL CHECK (optional_warnings >= 0),
  blocking_expectation_ids JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (JSONB_TYPEOF(blocking_expectation_ids) = 'array'),
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_name TEXT NOT NULL CHECK (LENGTH(BTRIM(created_by_name)) BETWEEN 2 AND 180),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, organization_id)
);

CREATE INDEX source_ingestion_readiness_snapshots_org_date_idx
  ON source_ingestion_readiness_snapshots(organization_id, business_date, created_at DESC);

CREATE OR REPLACE FUNCTION protect_accepted_source_ingestion_arrival()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.validation_status = 'accepted' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'accepted source ingestion arrivals are immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER source_ingestion_arrivals_accepted_immutable
  BEFORE UPDATE ON source_ingestion_arrivals
  FOR EACH ROW EXECUTE FUNCTION protect_accepted_source_ingestion_arrival();
