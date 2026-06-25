import type { PoolClient } from "pg";

export type SettlementRefreshResult = {
  scannedCount: number;
  createdCount: number;
  createdCaseIds: string[];
};

export async function lockSettlementRefresh(
  client: PoolClient,
  organizationId: string,
) {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 15015))",
    [organizationId],
  );
}

export async function promoteOverdueSettlements(
  client: PoolClient,
  organizationId: string,
): Promise<SettlementRefreshResult> {
  const candidates = await client.query<{
    item_id: string;
    run_id: string;
    severity: "low" | "medium" | "high";
  }>(
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

  if (candidates.rows.length === 0) {
    return { scannedCount: 0, createdCount: 0, createdCaseIds: [] };
  }

  const inserted = await client.query<{ id: string }>(
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

  return {
    scannedCount: candidates.rows.length,
    createdCount: inserted.rows.length,
    createdCaseIds: inserted.rows.map((row) => row.id),
  };
}
