import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { db, transaction } from "@/lib/db";
import { refreshPayoutSumChecks } from "@/lib/modules/reconciliation/reason-codes";
import { refreshRefundAllocations } from "@/lib/modules/refund-allocations/service";
import { listAllocationsForParent } from "@/lib/modules/refund-allocations/repository";
import type { NormalizedRefundRow } from "@/lib/types";

const organizationsToDelete: string[] = [];

async function makeOrg(label: string) {
  const slug = `refund-${label}-${randomUUID()}`;
  const org = await db.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1,$2) RETURNING id`,
    [`Refund ${label}`, slug],
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

async function makeCapture(input: {
  organizationId: string;
  runId: string;
  orderId: string;
  settledAmount: number;
  expectedNet: number;
  status?: string;
  reasonCode?: string | null;
  payoutId?: string | null;
}) {
  const result = await db.query<{ id: string }>(
    `INSERT INTO reconciliation_items (
       organization_id, run_id, order_id, gateway_reference, payment_mode,
       order_amount, gateway_amount, settled_amount, expected_net, variance,
       reconciliation_status, severity, summary, evidence,
       reason_code, payout_id
     ) VALUES (
       $1,$2,$3,$4,'UPI',1000,1000,$5,$6,
       (($5)::numeric - ($6)::numeric),
       $7,'medium','engine-written capture','[]',$8,$9
     ) RETURNING id`,
    [
      input.organizationId,
      input.runId,
      input.orderId,
      `${input.orderId}-PAY`,
      input.settledAmount,
      input.expectedNet,
      input.status ?? "amount_mismatch",
      input.reasonCode ?? null,
      input.payoutId ?? null,
    ],
  );
  return result.rows[0].id;
}

async function readItem(itemId: string) {
  const row = await db.query<{
    reason_code: string | null;
    summary: string;
    settled_amount: string | null;
    variance: string;
  }>(
    `SELECT reason_code, summary, settled_amount::text, variance::text
       FROM reconciliation_items WHERE id = $1`,
    [itemId],
  );
  return row.rows[0];
}

async function runRefresh(
  organizationId: string,
  candidates: NormalizedRefundRow[],
  runId?: string,
) {
  return transaction((client) =>
    refreshRefundAllocations(
      client,
      organizationId,
      candidates,
      "reconciliation_run_persisted",
      { id: null, name: "Test Harness" },
      runId,
    ),
  );
}

afterEach(async () => {
  while (organizationsToDelete.length) {
    await db.query("DELETE FROM organizations WHERE id = $1", [
      organizationsToDelete.pop(),
    ]);
  }
});

describe("refreshRefundAllocations", () => {
  it("links a refund to its parent capture in the same run and stamps refund_offset_recognized", async () => {
    const orgId = await makeOrg("same-run");
    const runId = await makeRun(orgId, "same-run");
    const orderId = `ORD-SAME-${randomUUID().slice(0, 6)}`;
    const itemId = await makeCapture({
      organizationId: orgId,
      runId,
      orderId,
      settledAmount: 700,
      expectedNet: 1000,
      reasonCode: "unmatched_other",
    });

    const result = await runRefresh(
      orgId,
      [
        {
          orderId,
          amount: 300,
          reference: `${orderId}-REFUND`,
          settlementAt: null,
          transactionAt: null,
          utr: "UTR-REF",
          statementReference: null,
        },
      ],
      runId,
    );

    expect(result).toMatchObject({
      candidatesEvaluated: 1,
      allocationsApplied: 1,
      itemsFlagged: 1,
      orphanRefunds: 0,
    });
    const item = await readItem(itemId);
    expect(item.reason_code).toBe("refund_offset_recognized");
    expect(item.summary).toContain("offset by refund(s)");
    expect(item.summary).toContain("₹300.00");
    expect(item.variance).toBe("-300.00");
  });

  it("links a refund to a parent capture from an earlier run (cross-run netting)", async () => {
    const orgId = await makeOrg("cross-run");
    const runA = await makeRun(orgId, "run-a");
    const runB = await makeRun(orgId, "run-b");
    const orderId = `ORD-X-${randomUUID().slice(0, 6)}`;
    const itemId = await makeCapture({
      organizationId: orgId,
      runId: runA,
      orderId,
      settledAmount: 700,
      expectedNet: 1000,
      reasonCode: "unmatched_other",
    });

    const result = await runRefresh(
      orgId,
      [
        {
          orderId,
          amount: 300,
          reference: `${orderId}-RETRO-REFUND`,
          settlementAt: null,
          transactionAt: null,
          utr: null,
          statementReference: null,
        },
      ],
      runB,
    );

    expect(result.itemsFlagged).toBe(1);
    const item = await readItem(itemId);
    expect(item.reason_code).toBe("refund_offset_recognized");
  });

  it("logs orphan refunds with no parent capture and stamps nothing", async () => {
    const orgId = await makeOrg("orphan");
    await makeRun(orgId, "orphan");
    const result = await runRefresh(orgId, [
      {
        orderId: "ORD-NEVER-SEEN",
        amount: 100,
        reference: "REF-ORPHAN",
        settlementAt: null,
        transactionAt: null,
        utr: null,
        statementReference: null,
      },
    ]);
    expect(result).toMatchObject({
      candidatesEvaluated: 1,
      allocationsApplied: 0,
      itemsFlagged: 0,
      orphanRefunds: 1,
    });
  });

  it("partial refunds: two ₹300 refunds against a ₹1000 capture eventually flip the flag; over-refund leaves it at amount_mismatch", async () => {
    const orgId = await makeOrg("partial");
    const runId = await makeRun(orgId, "partial");
    const orderId = `ORD-PART-${randomUUID().slice(0, 6)}`;
    const itemId = await makeCapture({
      organizationId: orgId,
      runId,
      orderId,
      settledAmount: 400,
      expectedNet: 1000,
      reasonCode: "unmatched_other",
    });

    // First refund of ₹300 brings effective settled to 700 → still off.
    const first = await runRefresh(
      orgId,
      [
        {
          orderId,
          amount: 300,
          reference: `${orderId}-R1`,
          settlementAt: null,
          transactionAt: null,
          utr: null,
          statementReference: null,
        },
      ],
      runId,
    );
    expect(first.itemsFlagged).toBe(0);
    expect((await readItem(itemId)).reason_code).toBe("unmatched_other");

    // Second refund of ₹300 brings effective settled to 1000 → ties out.
    const second = await runRefresh(
      orgId,
      [
        {
          orderId,
          amount: 300,
          reference: `${orderId}-R2`,
          settlementAt: null,
          transactionAt: null,
          utr: null,
          statementReference: null,
        },
      ],
      runId,
    );
    expect(second.itemsFlagged).toBe(1);
    expect((await readItem(itemId)).reason_code).toBe(
      "refund_offset_recognized",
    );

    // Third refund overshoots — effective 1300 vs expected 1000 → tolerance
    // exceeded → no new stamp; the existing flag stays (UPDATE is idempotent).
    const third = await runRefresh(
      orgId,
      [
        {
          orderId,
          amount: 300,
          reference: `${orderId}-R3`,
          settlementAt: null,
          transactionAt: null,
          utr: null,
          statementReference: null,
        },
      ],
      runId,
    );
    expect(third.allocationsApplied).toBe(1);
    expect(third.itemsFlagged).toBe(0);
    expect((await readItem(itemId)).reason_code).toBe(
      "refund_offset_recognized",
    );
  });

  it("idempotency: re-running the refresh on the same refund row produces exactly one allocation", async () => {
    const orgId = await makeOrg("idem");
    const runId = await makeRun(orgId, "idem");
    const orderId = `ORD-IDEM-${randomUUID().slice(0, 6)}`;
    const itemId = await makeCapture({
      organizationId: orgId,
      runId,
      orderId,
      settledAmount: 700,
      expectedNet: 1000,
      reasonCode: "unmatched_other",
    });
    const refund: NormalizedRefundRow = {
      orderId,
      amount: 300,
      reference: `${orderId}-DUP`,
      settlementAt: null,
      transactionAt: null,
      utr: null,
      statementReference: null,
    };

    const first = await runRefresh(orgId, [refund], runId);
    const second = await runRefresh(orgId, [refund], runId);

    expect(first.allocationsApplied).toBe(1);
    expect(second.allocationsApplied).toBe(0);

    const allocations = await db.connect();
    try {
      const list = await listAllocationsForParent(
        allocations,
        orgId,
        itemId,
      );
      expect(list).toHaveLength(1);
    } finally {
      allocations.release();
    }
  });

  it("precedence: payout_sum_mismatch wins over refund_offset_recognized", async () => {
    const orgId = await makeOrg("prec");
    const runId = await makeRun(orgId, "prec");
    const orderId = `ORD-PREC-${randomUUID().slice(0, 6)}`;
    const payoutId = `PAYOUT-PREC-${randomUUID().slice(0, 6)}`;
    const itemId = await makeCapture({
      organizationId: orgId,
      runId,
      orderId,
      settledAmount: 700,
      expectedNet: 1000,
      reasonCode: "unmatched_other",
      payoutId,
    });

    // Stage a payout group whose bank credit disagrees with item sum →
    // payout_sum_mismatch fires first.
    const merchant = await db.query<{ id: string }>(
      `INSERT INTO merchant_accounts (organization_id, merchant_reference, display_name)
       VALUES ($1,'merchant-prec','Prec Merchant') RETURNING id`,
      [orgId],
    );
    const batch = await db.query<{ id: string }>(
      `INSERT INTO merchant_settlement_batches (
         organization_id, merchant_account_id, source_run_id,
         statement_reference, provider_id, payment_mode, settlement_cycle,
         status, utr, expected_settlement_at, actual_settlement_at,
         gross_amount, deduction_amount, net_amount, bank_credit_amount,
         variance_amount, utr_match_status, classification_evidence
       ) VALUES (
         $1,$2,$3,$4,'generic','UPI','T+1','credited','UTR-prec',
         '2026-06-21T12:30:00Z','2026-06-21T13:00:00Z',
         0,0,0,0,0,'matched','{"fixture":true}'
       ) RETURNING id`,
      [orgId, merchant.rows[0].id, runId, payoutId],
    );
    await db.query(
      `INSERT INTO merchant_settlement_bank_credits (
         organization_id, batch_id, utr, amount, credited_at,
         bank_reference, match_status, evidence
       ) VALUES ($1,$2,'UTR-prec',500,'2026-06-21T13:00:00Z','BANK-prec','matched','{"fixture":true}')`,
      [orgId, batch.rows[0].id],
    );

    await transaction((client) =>
      refreshPayoutSumChecks(
        client,
        orgId,
        [payoutId],
        "reconciliation_run_persisted",
        { id: null, name: "Test" },
      ),
    );
    expect((await readItem(itemId)).reason_code).toBe("payout_sum_mismatch");

    // Now run refund allocation — even though sum would tie out, payout
    // sum mismatch wins precedence, so reason code does NOT flip.
    const refundResult = await runRefresh(
      orgId,
      [
        {
          orderId,
          amount: 300,
          reference: `${orderId}-PREC-REF`,
          settlementAt: null,
          transactionAt: null,
          utr: null,
          statementReference: null,
        },
      ],
      runId,
    );
    expect(refundResult.allocationsApplied).toBe(1);
    expect(refundResult.itemsFlagged).toBe(0);
    expect((await readItem(itemId)).reason_code).toBe("payout_sum_mismatch");
  });
});
