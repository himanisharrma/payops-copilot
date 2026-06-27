DO $$
DECLARE
  duplicate_hash_constraint TEXT;
BEGIN
  SELECT conname INTO duplicate_hash_constraint
  FROM pg_constraint
  WHERE conrelid = 'source_ingestion_arrivals'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) LIKE '%(organization_id, source_id, file_hash)%';

  IF duplicate_hash_constraint IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE source_ingestion_arrivals DROP CONSTRAINT %I',
      duplicate_hash_constraint
    );
  END IF;
END $$;

CREATE INDEX source_ingestion_arrivals_hash_lookup_idx
  ON source_ingestion_arrivals(organization_id, source_id, file_hash);
