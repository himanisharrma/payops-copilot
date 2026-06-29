import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/access";
import { db, transaction } from "@/lib/db";
import { getBalance, postCaptureEntries } from "@/lib/modules/ledger/service";
import { ensureDefaultMerchantAccount } from "@/lib/modules/merchant-settlements/repository";
import {
  getMerchantSettlement,
  loadMerchantSettlementWorkspace,
  refreshMerchantSettlements,
} from "@/lib/modules/merchant-settlements/service";

const organizationsToDelete: string[] = [];

async function fixture(label: string) {
  const slug = `merchant-settlements-${label}-${randomUUID()}`;
  const organization = await db.query<{ id: string }>(
    `INSERT INTO organizations (name, slug)
     VALUES ($1,$2) RETURNING id`,
    [`Merchant Settlements ${label}`, slug],
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
     ) VALUES ($1,$2,'upload','generic',2,1500,1500,0,2,0,100,'{}')
     RETURNING id`,
    [organizationId, `${label} Run`],
  );

  await db.query(
    `INSERT INTO reconciliation_items (
       organization_id, run_id, order_id, gateway_reference, payment_mode,
       order_amount, gateway_amount, settled_amount, expected_net, variance,
       reconciliation_status, severity, summary, evidence, transaction_at,
       transaction_timestamp_source, settlement_recorded_at, settlement_cycle,
       expected_settlement_at, settlement_policy_version,
       settlement_calendar_version, settlement_timing_evidence
     ) VALUES
     (
       $1,$2,$3,$4,'UPI',1000,1000,970,970,0,
       'matched','low','Matched settlement','[]',
       '2026-06-20T10:00:00Z','gateway_capture',
       '2026-06-21T10:00:00Z','T+1',
       '2026-06-21T12:30:00Z',
       'settlement-policy-v1','india-demo-calendar-v1',
       '{"fixture":true}'
     ),
     (
       $1,$2,$5,$6,'UPI',500,500,485,485,0,
       'matched','low','Matched settlement','[]',
       '2026-06-20T11:00:00Z','gateway_capture',
       '2026-06-21T10:05:00Z','T+1',
       '2026-06-21T12:30:00Z',
       'settlement-policy-v1','india-demo-calendar-v1',
       '{"fixture":true}'
     )`,
    [
      organizationId,
      run.rows[0].id,
      `${label}-ORDER-1`,
      `${label}-PAY-1`,
      `${label}-ORDER-2`,
      `${label}-PAY-2`,
    ],
  );

  const actor: Actor = {
    id: user.rows[0].id,
    name: `${label} Admin`,
    role: "admin",
    organizationId,
    organizationName: `Merchant Settlements ${label}`,
  };
  return { actor, organizationId };
}

afterEach(async () => {
  while (organizationsToDelete.length) {
    await db.query("DELETE FROM organizations WHERE id = $1", [
      organizationsToDelete.pop(),
    ]);
  }
});

describe("merchant settlement statements", () => {
  it("refreshes, lists, and loads detail inside one tenant", async () => {
    const tenant = await fixture("tenant-a");

    await expect(
      refreshMerchantSettlements(tenant.actor, {
        now: new Date("2026-06-25T12:00:00Z"),
      }),
    ).resolves.toEqual({
      scannedItems: 2,
      refreshedBatches: 1,
      createdBatches: 1,
      updatedBatches: 0,
    });

    const workspace = await loadMerchantSettlementWorkspace(
      tenant.organizationId,
      new URLSearchParams(),
    );
    expect(workspace.summary).toMatchObject({
      batchCount: 1,
      grossAmount: 1500,
      deductionAmount: 45,
      netAmount: 1455,
      bankCreditAmount: 1455,
      exceptionCount: 0,
    });
    expect(workspace.settlements[0]).toMatchObject({
      status: "credited",
      utrMatchStatus: "matched",
      lineCount: 2,
      deductionCount: 1,
    });

    const detail = await getMerchantSettlement(
      workspace.settlements[0].id,
      tenant.organizationId,
    );
    expect(detail).toMatchObject({
      id: workspace.settlements[0].id,
      bankCreditAmount: 1455,
    });
    expect(detail?.lines).toHaveLength(2);
    expect(detail?.bankCredits).toHaveLength(1);
    expect(detail?.events[0]).toMatchObject({ eventType: "batch_refreshed" });
  });

  // Slice 6b canary: ship-blocker if drift > ₹0.01. Asserts that after
  // captures + settlement refresh, the per-PG provider_receivable
  // balance ties out (PG paid us in full, ₹0 owed) and fee_expense
  // matches the deductionAmount the existing arithmetic computes.
  // If this drifts, Bridge 2 is posting the wrong amounts → DO NOT
  // ship Slice 6b until fixed.
  it("canary: ledger provider_receivable ties to zero + fee_expense matches deduction after refresh", async () => {
    const tenant = await fixture("canary-tie");

    // Simulate Bridge 1: post captures to ledger for the 2 seeded
    // matched items (the fixture inserts items directly, bypassing
    // createReconciliationRun where Bridge 1 actually fires).
    const seededItems = await db.query<{
      id: string;
      order_id: string;
      gateway_reference: string;
      order_amount: string;
      transaction_at: Date | null;
    }>(
      `SELECT id, order_id, gateway_reference,
              order_amount::text AS order_amount, transaction_at
         FROM reconciliation_items
        WHERE organization_id = $1
        ORDER BY transaction_at`,
      [tenant.organizationId],
    );
    expect(seededItems.rowCount).toBe(2);

    await transaction(async (client) => {
      const merchantAccountId = await ensureDefaultMerchantAccount(
        client,
        tenant.organizationId,
      );
      await postCaptureEntries(
        client,
        tenant.organizationId,
        seededItems.rows.map((row) => ({
          sourceItemId: row.id,
          merchantAccountId,
          provider: "generic" as const,
          grossAmount: Number(row.order_amount),
          effectiveAt: row.transaction_at ?? new Date(),
          externalRefs: {
            orderId: row.order_id,
            gatewayReference: row.gateway_reference,
          },
        })),
        { id: tenant.actor.id, name: tenant.actor.name },
      );
    });

    // Bridge 2 fires inside refreshMerchantSettlements.
    await refreshMerchantSettlements(tenant.actor, {
      now: new Date("2026-06-25T12:00:00Z"),
    });

    // Read ledger state for the merchant.
    const merchantAccountId = await transaction((client) =>
      ensureDefaultMerchantAccount(client, tenant.organizationId),
    );
    const balances = await transaction((client) =>
      getBalance(
        client,
        tenant.organizationId,
        merchantAccountId,
        new Date("2026-06-26T00:00:00Z"),
      ),
    );

    // For the seeded data (gross 1500, net 1455, deduction 45):
    //   provider_receivable (generic) = 1500 captures - 45 fee
    //     - 1455 bank credit = 0  ← PG tied out ✓
    //   fee_expense (generic) = 45  ← deductions recognized
    //   merchant_payable = 1500 captures - 1455 payout = 45  ← gap
    //   escrow_cash = 1455 in - 1455 out = 0
    const providerReceivable =
      balances.find(
        (row) =>
          row.accountRole === "provider_receivable" &&
          row.provider === "generic",
      )?.balance ?? null;
    const feeExpense =
      balances.find(
        (row) =>
          row.accountRole === "fee_expense" && row.provider === "generic",
      )?.balance ?? null;
    const merchantPayable =
      balances.find((row) => row.accountRole === "merchant_payable")?.balance ??
      null;
    const escrowCash =
      balances.find((row) => row.accountRole === "escrow_cash")?.balance ??
      null;

    expect(providerReceivable).toBeCloseTo(0, 2);
    expect(feeExpense).toBeCloseTo(45, 2);
    expect(merchantPayable).toBeCloseTo(45, 2);
    expect(escrowCash).toBeCloseTo(0, 2);
  });

  it("keeps list, detail, and refresh scoped to actor organization", async () => {
    const tenantA = await fixture("tenant-a");
    const tenantB = await fixture("tenant-b");

    await refreshMerchantSettlements(tenantB.actor, {
      now: new Date("2026-06-25T12:00:00Z"),
    });

    const tenantAWorkspace = await loadMerchantSettlementWorkspace(
      tenantA.organizationId,
      new URLSearchParams(),
    );
    expect(tenantAWorkspace.settlements).toHaveLength(0);

    const tenantBWorkspace = await loadMerchantSettlementWorkspace(
      tenantB.organizationId,
      new URLSearchParams(),
    );
    expect(tenantBWorkspace.settlements).toHaveLength(1);
    await expect(
      getMerchantSettlement(
        tenantBWorkspace.settlements[0].id,
        tenantA.organizationId,
      ),
    ).resolves.toBeNull();
  });
});
