import pg from "pg";

const organizationArgument = process.argv.find((value) =>
  value.startsWith("--organization="),
);
const organizationSlug = organizationArgument?.slice(
  "--organization=".length,
);

if (!organizationSlug) {
  console.error(
    "Usage: npm run settlements:refresh -- --organization=<organization-slug>",
  );
  process.exit(1);
}

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://payops:payops_local@127.0.0.1:5438/payops";
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  const organization = await client.query(
    "SELECT id FROM organizations WHERE slug = $1",
    [organizationSlug],
  );
  if (!organization.rowCount) {
    throw new Error(`Organization "${organizationSlug}" was not found.`);
  }
  const organizationId = organization.rows[0].id;

  await client.query("BEGIN");
  try {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 15015))",
      [organizationId],
    );
    const candidates = await client.query(
      `SELECT item.id AS item_id, item.run_id, item.severity
       FROM reconciliation_items item
       JOIN reconciliation_runs run
         ON run.id = item.run_id
        AND run.organization_id = item.organization_id
       LEFT JOIN operations_cases payment_case
         ON payment_case.item_id = item.id
        AND payment_case.organization_id = item.organization_id
       WHERE item.organization_id = $1
         AND item.reconciliation_status = 'missing_settlement'
         AND item.expected_settlement_at IS NOT NULL
         AND item.expected_settlement_at < NOW()
         AND item.settlement_recorded_at IS NULL
         AND payment_case.id IS NULL
       ORDER BY item.expected_settlement_at ASC, item.id ASC
       FOR UPDATE OF item`,
      [organizationId],
    );

    let createdCaseIds = [];
    if (candidates.rowCount) {
      const inserted = await client.query(
        `INSERT INTO operations_cases (
           organization_id, item_id, run_id, priority, due_at, case_origin
         )
         SELECT
           $1,
           candidate.item_id,
           candidate.run_id,
           candidate.severity,
           NOW() + CASE candidate.severity
             WHEN 'high' THEN INTERVAL '4 hours'
             WHEN 'medium' THEN INTERVAL '24 hours'
             ELSE INTERVAL '72 hours'
           END,
           'settlement_overdue'
         FROM UNNEST($2::uuid[], $3::uuid[], $4::text[])
           AS candidate(item_id, run_id, severity)
         ON CONFLICT (item_id) DO NOTHING
         RETURNING id`,
        [
          organizationId,
          candidates.rows.map((row) => row.item_id),
          candidates.rows.map((row) => row.run_id),
          candidates.rows.map((row) => row.severity),
        ],
      );
      createdCaseIds = inserted.rows.map((row) => row.id);
    }

    await client.query(
      `INSERT INTO audit_events (
         organization_id, actor_user_id, actor_name, action,
         entity_type, entity_id, details
       ) VALUES ($1::uuid,NULL,'Settlement Control CLI',
         'settlement_control.refreshed','organization',$1::text,$2)`,
      [
        organizationId,
        JSON.stringify({
          scannedCount: candidates.rowCount,
          createdCount: createdCaseIds.length,
          createdCaseIds,
        }),
      ],
    );
    await client.query("COMMIT");
    console.log(
      `Settlement refresh scanned ${candidates.rowCount} candidate(s) and created ${createdCaseIds.length} case(s).`,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}
