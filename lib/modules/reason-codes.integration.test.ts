import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { db, transaction } from "@/lib/db";
import { refreshReasonCodesForOrders } from "@/lib/modules/reconciliation/reason-codes";
import { changePaymentWorkflow } from "@/lib/modules/payment-workflows/service";
import type { Actor } from "@/lib/access";

const organizationsToDelete: string[] = [];

async function fixture(label: string) {
  const slug = `reason-codes-${label}-${randomUUID()}`;
  const organization = await db.query<{ id: string }>(
    `INSERT INTO organizations (name, slug)
     VALUES ($1, $2) RETURNING id`,
    [`ReasonCodes ${label}`, slug],
  );
  const organizationId = organization.rows[0].id;
  organizationsToDelete.push(organizationId);

  const user = await db.query<{ id: string }>(
    `INSERT INTO users (
       organization_id, name, email, password_hash, role
     ) VALUES ($1,$2,$3,'test-hash','admin')
     RETURNING id`,
    [organizationId, `${label} Admin`, `${slug}@example.test`],
  );
  const run = await db.query<{ id: string }>(
    `INSERT INTO reconciliation_runs (
       organization_id, name, source_type, provider_id, total_orders,
       processed_value, matched_value, unmatched_value, matched_count,
       exception_count, match_rate, source_files
     ) VALUES ($1,$2,'upload','generic',1,1000,0,1000,0,1,0,'{}')
     RETURNING id`,
    [organizationId, `${label} Run`],
  );
  const orderId = `${label}-${randomUUID().slice(0, 8)}`;
  const item = await db.query<{ id: string }>(
    `INSERT INTO reconciliation_items (
       organization_id, run_id, order_id, gateway_reference, payment_mode,
       order_amount, gateway_amount, settled_amount, expected_net, variance,
       reconciliation_status, severity, summary, evidence
     ) VALUES (
       $1,$2,$3,$4,'UPI',1000,1000,900,990,-90,
       'amount_mismatch','high','Mismatch','[]'
     ) RETURNING id`,
    [organizationId, run.rows[0].id, orderId, `${label}-PAY`],
  );
  const actor: Actor = {
    id: user.rows[0].id,
    name: `${label} Admin`,
    role: "admin",
    organizationId,
    organizationName: `ReasonCodes ${label}`,
  };
  return { organizationId, itemId: item.rows[0].id, orderId, actor };
}

async function readReasonCode(itemId: string): Promise<string | null> {
  const row = await db.query<{ reason_code: string | null }>(
    `SELECT reason_code FROM reconciliation_items WHERE id = $1`,
    [itemId],
  );
  return row.rows[0]?.reason_code ?? null;
}

afterEach(async () => {
  while (organizationsToDelete.length) {
    await db.query("DELETE FROM organizations WHERE id = $1", [
      organizationsToDelete.pop(),
    ]);
  }
});

describe("cross-table reason-code refresh", () => {
  it("stamps hold_unexplained when a related merchant_settlement_batch is held", async () => {
    const t = await fixture("hold");

    // Plant a held batch + line linked to the item's order_id
    const account = await db.query<{ id: string }>(
      `INSERT INTO merchant_accounts (
         organization_id, merchant_reference, display_name
       ) VALUES ($1, $2, 'Hold merchant') RETURNING id`,
      [t.organizationId, `MID-${randomUUID().slice(0, 8)}`],
    );
    const batch = await db.query<{ id: string }>(
      `INSERT INTO merchant_settlement_batches (
         organization_id, merchant_account_id, statement_reference,
         provider_id, payment_mode, settlement_cycle,
         expected_settlement_at, gross_amount, deduction_amount,
         net_amount, bank_credit_amount, variance_amount, status
       ) VALUES (
         $1,$2,$3,'generic','UPI','T+1',
         NOW() + INTERVAL '1 day',1000,0,1000,0,0,'held'
       ) RETURNING id`,
      [t.organizationId, account.rows[0].id, `STM-${randomUUID().slice(0, 8)}`],
    );
    await db.query(
      `INSERT INTO merchant_settlement_lines (
         organization_id, batch_id, order_id, gateway_reference,
         payment_mode, gross_amount, deduction_amount, net_amount,
         line_status
       ) VALUES (
         $1, $2, $3, 'PAY-X', 'UPI', 1000, 0, 1000, 'held'
       )`,
      [t.organizationId, batch.rows[0].id, t.orderId],
    );

    await transaction((client) =>
      refreshReasonCodesForOrders(
        client,
        t.organizationId,
        [t.orderId],
        "merchant_settlement_status_changed",
        { id: t.actor.id, name: t.actor.name },
      ),
    );
    expect(await readReasonCode(t.itemId)).toBe("hold_unexplained");
  });

  it("stamps chargeback_pending_recovery when a chargeback workflow opens against the order", async () => {
    const t = await fixture("chargeback");

    const workflow = await db.query<{ id: string }>(
      `INSERT INTO payment_workflows (
         organization_id, workflow_type, external_reference, order_id,
         payment_reference, amount, reason, status, priority, due_at,
         evidence_checklist
       ) VALUES (
         $1,'chargeback','CB-1',$2,'PAY-CB',1000,'merchant_dispute',
         'received','high', NOW() + INTERVAL '24 hours','[]'
       ) RETURNING id`,
      [t.organizationId, t.orderId],
    );

    await changePaymentWorkflow(
      workflow.rows[0].id,
      { status: "evidence_due" },
      t.actor,
    );

    expect(await readReasonCode(t.itemId)).toBe("chargeback_pending_recovery");
  });
});
