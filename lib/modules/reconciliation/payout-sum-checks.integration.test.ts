import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { db, transaction } from "@/lib/db";
import {
  refreshPayoutSumChecks,
  refreshReasonCodesForOrders,
} from "@/lib/modules/reconciliation/reason-codes";

const organizationsToDelete: string[] = [];

async function makeOrg(label: string) {
  const slug = `payout-sum-${label}-${randomUUID()}`;
  const org = await db.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1,$2) RETURNING id`,
    [`PayoutSum ${label}`, slug],
  );
  organizationsToDelete.push(org.rows[0].id);
  return org.rows[0].id;
}

async function makeRun(organizationId: string, label: string) {
  const run = await db.query<{ id: string }>(
    `INSERT INTO reconciliation_runs (
       organization_id, name, source_type, provider_id, total_orders,
       processed_value, matched_value, unmatched_value, matched_count,
       exception_count, match_rate, source_files
     ) VALUES ($1,$2,'upload','generic',0,0,0,0,0,0,0,'{}')
     RETURNING id`,
    [organizationId, `${label} run`],
  );
  return run.rows[0].id;
}

async function makeMerchant(organizationId: string) {
  const m = await db.query<{ id: string }>(
    `INSERT INTO merchant_accounts (organization_id, merchant_reference, display_name)
     VALUES ($1,'merchant-demo','Demo Merchant') RETURNING id`,
    [organizationId],
  );
  return m.rows[0].id;
}

async function makeItem(input: {
  organizationId: string;
  runId: string;
  orderId: string;
  settledAmount: number | null;
  payoutId: string | null;
  reasonCode?: string | null;
  status?: string;
}) {
  const result = await db.query<{ id: string }>(
    `INSERT INTO reconciliation_items (
       organization_id, run_id, order_id, gateway_reference, payment_mode,
       order_amount, gateway_amount, settled_amount, expected_net, variance,
       reconciliation_status, severity, summary, evidence,
       reason_code, payout_id
     ) VALUES (
       $1,$2,$3,$4,'UPI',1000,1000,$5,990,0,
       $6,'medium','seed','[]',$7,$8
     ) RETURNING id`,
    [
      input.organizationId,
      input.runId,
      input.orderId,
      `${input.orderId}-PAY`,
      input.settledAmount,
      input.status ?? "matched",
      input.reasonCode ?? null,
      input.payoutId,
    ],
  );
  return result.rows[0].id;
}

async function makeBatch(input: {
  organizationId: string;
  merchantAccountId: string;
  runId: string;
  statementReference: string;
}) {
  const result = await db.query<{ id: string }>(
    `INSERT INTO merchant_settlement_batches (
       organization_id, merchant_account_id, source_run_id,
       statement_reference, provider_id, payment_mode, settlement_cycle,
       status, utr, expected_settlement_at, actual_settlement_at,
       gross_amount, deduction_amount, net_amount, bank_credit_amount,
       variance_amount, utr_match_status, classification_evidence
     ) VALUES (
       $1,$2,$3,$4,'generic','UPI','T+1','credited','UTR-x',
       '2026-06-21T12:30:00Z','2026-06-21T13:00:00Z',
       0,0,0,0,0,'matched','{"fixture":true}'
     ) RETURNING id`,
    [
      input.organizationId,
      input.merchantAccountId,
      input.runId,
      input.statementReference,
    ],
  );
  return result.rows[0].id;
}

async function makeBankCredit(input: {
  organizationId: string;
  batchId: string;
  amount: number;
  utr?: string;
}) {
  await db.query(
    `INSERT INTO merchant_settlement_bank_credits (
       organization_id, batch_id, utr, amount, credited_at,
       bank_reference, match_status, evidence
     ) VALUES ($1,$2,$3,$4,'2026-06-21T13:00:00Z','BANK-x','matched','{"fixture":true}')`,
    [
      input.organizationId,
      input.batchId,
      input.utr ?? `UTR-${input.batchId.slice(0, 8)}`,
      input.amount,
    ],
  );
}

async function readReasonCode(itemId: string): Promise<string | null> {
  const row = await db.query<{ reason_code: string | null }>(
    `SELECT reason_code FROM reconciliation_items WHERE id = $1`,
    [itemId],
  );
  return row.rows[0]?.reason_code ?? null;
}

async function runRefresh(organizationId: string, payoutIds: string[]) {
  return transaction((client) =>
    refreshPayoutSumChecks(client, organizationId, payoutIds, "reconciliation_run_persisted", {
      id: null,
      name: "Test Harness",
    }),
  );
}

afterEach(async () => {
  while (organizationsToDelete.length) {
    await db.query("DELETE FROM organizations WHERE id = $1", [
      organizationsToDelete.pop(),
    ]);
  }
});

describe("refreshPayoutSumChecks", () => {
  it("does nothing when payoutIds is empty", async () => {
    const orgId = await makeOrg("empty");
    const result = await runRefresh(orgId, []);
    expect(result).toEqual({
      groupsChecked: 0,
      groupsMismatched: 0,
      groupsDeferred: 0,
      itemsFlagged: 0,
      itemsCleared: 0,
    });
  });

  it("leaves items unflagged when the group sum ties to the bank credit", async () => {
    const orgId = await makeOrg("match");
    const runId = await makeRun(orgId, "match");
    const merchantId = await makeMerchant(orgId);
    const payoutId = `STM-MATCH-${randomUUID().slice(0, 8)}`;
    const itemA = await makeItem({
      organizationId: orgId,
      runId,
      orderId: `${payoutId}-A`,
      settledAmount: 500,
      payoutId,
    });
    const itemB = await makeItem({
      organizationId: orgId,
      runId,
      orderId: `${payoutId}-B`,
      settledAmount: 300,
      payoutId,
    });
    const itemC = await makeItem({
      organizationId: orgId,
      runId,
      orderId: `${payoutId}-C`,
      settledAmount: 200,
      payoutId,
    });
    const batchId = await makeBatch({
      organizationId: orgId,
      merchantAccountId: merchantId,
      runId,
      statementReference: payoutId,
    });
    await makeBankCredit({ organizationId: orgId, batchId, amount: 1000 });
    const result = await runRefresh(orgId, [payoutId]);
    expect(result).toMatchObject({
      groupsChecked: 1,
      groupsMismatched: 0,
      itemsFlagged: 0,
    });
    for (const id of [itemA, itemB, itemC]) {
      await expect(readReasonCode(id)).resolves.toBeNull();
    }
  });

  it("flags every settled item with payout_sum_mismatch when the bank credit is short", async () => {
    const orgId = await makeOrg("mismatch");
    const runId = await makeRun(orgId, "mismatch");
    const merchantId = await makeMerchant(orgId);
    const payoutId = `STM-MISMATCH-${randomUUID().slice(0, 8)}`;
    const settledIds: string[] = [];
    for (const amount of [200, 200, 200, 200, 200]) {
      settledIds.push(
        await makeItem({
          organizationId: orgId,
          runId,
          orderId: `${payoutId}-${randomUUID().slice(0, 4)}`,
          settledAmount: amount,
          payoutId,
        }),
      );
    }
    // Item with no settlement — must be excluded from the sum and not flagged.
    const unsettledId = await makeItem({
      organizationId: orgId,
      runId,
      orderId: `${payoutId}-MISS`,
      settledAmount: null,
      payoutId,
      status: "missing_settlement",
    });
    const batchId = await makeBatch({
      organizationId: orgId,
      merchantAccountId: merchantId,
      runId,
      statementReference: payoutId,
    });
    await makeBankCredit({ organizationId: orgId, batchId, amount: 750 });

    const result = await runRefresh(orgId, [payoutId]);
    expect(result).toMatchObject({
      groupsChecked: 1,
      groupsMismatched: 1,
      itemsFlagged: 5,
    });
    for (const id of settledIds) {
      await expect(readReasonCode(id)).resolves.toBe("payout_sum_mismatch");
    }
    await expect(readReasonCode(unsettledId)).resolves.toBeNull();

    const summary = await db.query<{ summary: string }>(
      `SELECT summary FROM reconciliation_items WHERE id = $1`,
      [settledIds[0]],
    );
    expect(summary.rows[0].summary).toContain(payoutId);
    expect(summary.rows[0].summary).toContain("₹1000.00");
    expect(summary.rows[0].summary).toContain("₹750.00");

    const audit = await db.query<{ details: { groupsMismatched: number } }>(
      `SELECT details FROM audit_events
       WHERE organization_id = $1 AND action = 'reason_code.payout_sum_recomputed'
       ORDER BY created_at DESC LIMIT 1`,
      [orgId],
    );
    expect(audit.rows[0].details.groupsMismatched).toBe(1);
  });

  it("defers silently when the batch row is missing", async () => {
    const orgId = await makeOrg("deferred");
    const runId = await makeRun(orgId, "deferred");
    const payoutId = `STM-NONE-${randomUUID().slice(0, 8)}`;
    const itemId = await makeItem({
      organizationId: orgId,
      runId,
      orderId: `${payoutId}-A`,
      settledAmount: 500,
      payoutId,
    });
    const result = await runRefresh(orgId, [payoutId]);
    expect(result).toMatchObject({
      groupsChecked: 0,
      groupsDeferred: 1,
      itemsFlagged: 0,
    });
    await expect(readReasonCode(itemId)).resolves.toBeNull();
  });

  it("preserves payout_sum_mismatch precedence against per-item refresh and clears when bank credit is fixed", async () => {
    const orgId = await makeOrg("precedence");
    const runId = await makeRun(orgId, "precedence");
    const merchantId = await makeMerchant(orgId);
    const payoutId = `STM-PRECEDENCE-${randomUUID().slice(0, 8)}`;
    const orderId = `${payoutId}-A`;
    const itemId = await makeItem({
      organizationId: orgId,
      runId,
      orderId,
      settledAmount: 500,
      payoutId,
      reasonCode: "utr_missing",
    });
    const batchId = await makeBatch({
      organizationId: orgId,
      merchantAccountId: merchantId,
      runId,
      statementReference: payoutId,
    });
    // Bank credit short of the item sum → mismatch → overwrite utr_missing.
    await makeBankCredit({ organizationId: orgId, batchId, amount: 250 });

    await runRefresh(orgId, [payoutId]);
    await expect(readReasonCode(itemId)).resolves.toBe("payout_sum_mismatch");

    // Per-item refresh must NOT overwrite payout_sum_mismatch.
    await transaction((client) =>
      refreshReasonCodesForOrders(
        client,
        orgId,
        [orderId],
        "merchant_settlement_status_changed",
        { id: null, name: "Test" },
      ),
    );
    await expect(readReasonCode(itemId)).resolves.toBe("payout_sum_mismatch");

    // Fix bank credit (add another credit row so sum reaches 500), refresh.
    await makeBankCredit({
      organizationId: orgId,
      batchId,
      amount: 250,
      utr: "UTR-extra",
    });
    await runRefresh(orgId, [payoutId]);
    await expect(readReasonCode(itemId)).resolves.toBeNull();
  });

  it("respects the ₹0.01 tolerance on the sum check", async () => {
    const orgId = await makeOrg("tolerance");
    const runId = await makeRun(orgId, "tolerance");
    const merchantId = await makeMerchant(orgId);

    const onCentPayout = `STM-ONECENT-${randomUUID().slice(0, 8)}`;
    const onCentItem = await makeItem({
      organizationId: orgId,
      runId,
      orderId: `${onCentPayout}-A`,
      settledAmount: 500.0,
      payoutId: onCentPayout,
    });
    const onCentBatch = await makeBatch({
      organizationId: orgId,
      merchantAccountId: merchantId,
      runId,
      statementReference: onCentPayout,
    });
    await makeBankCredit({
      organizationId: orgId,
      batchId: onCentBatch,
      amount: 499.99,
    });

    const twoCentPayout = `STM-TWOCENT-${randomUUID().slice(0, 8)}`;
    const twoCentItem = await makeItem({
      organizationId: orgId,
      runId,
      orderId: `${twoCentPayout}-A`,
      settledAmount: 500.0,
      payoutId: twoCentPayout,
    });
    const twoCentBatch = await makeBatch({
      organizationId: orgId,
      merchantAccountId: merchantId,
      runId,
      statementReference: twoCentPayout,
    });
    await makeBankCredit({
      organizationId: orgId,
      batchId: twoCentBatch,
      amount: 499.98,
    });

    await runRefresh(orgId, [onCentPayout, twoCentPayout]);
    await expect(readReasonCode(onCentItem)).resolves.toBeNull();
    await expect(readReasonCode(twoCentItem)).resolves.toBe(
      "payout_sum_mismatch",
    );
  });
});
