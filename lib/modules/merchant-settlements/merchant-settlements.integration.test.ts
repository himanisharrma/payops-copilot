import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/access";
import { db } from "@/lib/db";
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
