ALTER TABLE source_ingestion_arrivals
  ADD COLUMN version_number INTEGER;

ALTER TABLE source_ingestion_arrivals
  DISABLE TRIGGER source_ingestion_arrivals_accepted_immutable;

WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY organization_id, expectation_id
    ORDER BY received_at, created_at, id
  ) AS version_number
  FROM source_ingestion_arrivals
)
UPDATE source_ingestion_arrivals arrival
SET version_number = numbered.version_number
FROM numbered
WHERE numbered.id = arrival.id;

ALTER TABLE source_ingestion_arrivals
  ENABLE TRIGGER source_ingestion_arrivals_accepted_immutable;

ALTER TABLE source_ingestion_arrivals
  ALTER COLUMN version_number SET NOT NULL,
  ADD CONSTRAINT source_ingestion_arrival_version_unique
    UNIQUE (organization_id, expectation_id, version_number);

ALTER TABLE source_ingestion_readiness_snapshots
  ADD COLUMN seed_marker TEXT;
