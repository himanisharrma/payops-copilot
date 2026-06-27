// Slice 2b cross-table reason-code backfill.
//
// Applies the 5 cross-table reason codes (utr_duplicate, payout_failed,
// hold_unexplained, chargeback_pending_recovery, refund_not_adjusted) to
// reconciliation_items rows whose reason_code is NULL, by joining
// merchant_settlement_batches/lines and payment_workflows on (organization_id,
// order_id). Re-runnable: the `reason_code IS NULL` guard makes every UPDATE
// idempotent.
//
// IMPORTANT: the SQL rules in this script MUST mirror classifyWithContext()
// in lib/modules/reconciliation/reason-codes.ts. If you change the priority
// order or any status set there, update both. The integration test in
// lib/modules/reason-codes.integration.test.ts asserts the SQL path end-to-end.

import pg from "pg";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://payops:payops_local@127.0.0.1:5438/payops";

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

const totals = {
  utr_duplicate: 0,
  payout_failed: 0,
  hold_unexplained: 0,
  chargeback_pending_recovery: 0,
  refund_not_adjusted: 0,
};

try {
  const orgs = await client.query("SELECT id, name FROM organizations");
  for (const org of orgs.rows) {
    const counts = await backfillOrg(org.id);
    for (const [code, n] of Object.entries(counts)) {
      totals[code] += n;
    }
    console.log(
      `[${org.name}] utr_duplicate=${counts.utr_duplicate}` +
        ` payout_failed=${counts.payout_failed}` +
        ` hold_unexplained=${counts.hold_unexplained}` +
        ` chargeback_pending_recovery=${counts.chargeback_pending_recovery}` +
        ` refund_not_adjusted=${counts.refund_not_adjusted}`,
    );
  }
  console.log("---");
  console.log(
    `Total updates: ${Object.values(totals).reduce((a, b) => a + b, 0)}`,
  );
  for (const [code, n] of Object.entries(totals)) {
    console.log(`  ${code}: ${n}`);
  }
} finally {
  await client.end();
}

async function backfillOrg(organizationId) {
  // 1. utr_duplicate — items linked to a batch whose UTR is shared with another batch
  const utrDup = await client.query(
    `UPDATE reconciliation_items i
        SET reason_code = 'utr_duplicate'
      WHERE i.organization_id = $1
        AND i.reason_code IS NULL
        AND EXISTS (
          SELECT 1
            FROM merchant_settlement_lines l
            JOIN merchant_settlement_batches b1
              ON b1.id = l.batch_id AND b1.organization_id = l.organization_id
           WHERE l.order_id = i.order_id
             AND l.organization_id = i.organization_id
             AND b1.utr IS NOT NULL
             AND b1.utr IN (
                 SELECT utr FROM merchant_settlement_batches
                  WHERE organization_id = $1 AND utr IS NOT NULL
                  GROUP BY utr HAVING COUNT(*) > 1
             )
        )`,
    [organizationId],
  );

  // 2. payout_failed — items linked to a failed batch
  const failed = await client.query(
    `UPDATE reconciliation_items i
        SET reason_code = 'payout_failed'
      WHERE i.organization_id = $1
        AND i.reason_code IS NULL
        AND EXISTS (
          SELECT 1
            FROM merchant_settlement_lines l
            JOIN merchant_settlement_batches b
              ON b.id = l.batch_id AND b.organization_id = l.organization_id
           WHERE l.order_id = i.order_id
             AND l.organization_id = i.organization_id
             AND b.status IN ('failed', 'payout_failed')
        )`,
    [organizationId],
  );

  // 3. hold_unexplained — items linked to a held batch
  const held = await client.query(
    `UPDATE reconciliation_items i
        SET reason_code = 'hold_unexplained'
      WHERE i.organization_id = $1
        AND i.reason_code IS NULL
        AND EXISTS (
          SELECT 1
            FROM merchant_settlement_lines l
            JOIN merchant_settlement_batches b
              ON b.id = l.batch_id AND b.organization_id = l.organization_id
           WHERE l.order_id = i.order_id
             AND l.organization_id = i.organization_id
             AND b.status IN ('held', 'credited_held')
        )`,
    [organizationId],
  );

  // 4. chargeback_pending_recovery — items with open chargeback workflow on the order
  const chargeback = await client.query(
    `UPDATE reconciliation_items i
        SET reason_code = 'chargeback_pending_recovery'
      WHERE i.organization_id = $1
        AND i.reason_code IS NULL
        AND EXISTS (
          SELECT 1 FROM payment_workflows w
           WHERE w.organization_id = i.organization_id
             AND w.order_id = i.order_id
             AND w.workflow_type = 'chargeback'
             AND w.status IN ('received', 'evidence_due', 'evidence_submitted')
        )`,
    [organizationId],
  );

  // 5. refund_not_adjusted — items with open refund workflow on the order,
  //    only when reconciliation_status is amount_mismatch or missing_settlement
  const refund = await client.query(
    `UPDATE reconciliation_items i
        SET reason_code = 'refund_not_adjusted'
      WHERE i.organization_id = $1
        AND i.reason_code IS NULL
        AND i.reconciliation_status IN ('amount_mismatch', 'missing_settlement')
        AND EXISTS (
          SELECT 1 FROM payment_workflows w
           WHERE w.organization_id = i.organization_id
             AND w.order_id = i.order_id
             AND w.workflow_type = 'refund'
             AND w.status IN ('requested', 'approved', 'processing')
        )`,
    [organizationId],
  );

  return {
    utr_duplicate: utrDup.rowCount ?? 0,
    payout_failed: failed.rowCount ?? 0,
    hold_unexplained: held.rowCount ?? 0,
    chargeback_pending_recovery: chargeback.rowCount ?? 0,
    refund_not_adjusted: refund.rowCount ?? 0,
  };
}
