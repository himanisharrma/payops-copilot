import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/access";
import { db } from "@/lib/db";
import { refreshSettlementControl } from "@/lib/modules/settlement-control/service";

const organizationsToDelete: string[] = [];

async function fixture(label: string, overdue: boolean) {
  const slug = `settlement-control-${label}-${randomUUID()}`;
  const organization = await db.query<{ id: string }>(
    `INSERT INTO organizations (name, slug)
     VALUES ($1,$2) RETURNING id`,
    [`Settlement Control ${label}`, slug],
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
  const item = await db.query<{ id: string }>(
    `INSERT INTO reconciliation_items (
       organization_id, run_id, order_id, gateway_reference, payment_mode,
       order_amount, gateway_amount, settled_amount, expected_net, variance,
       reconciliation_status, severity, summary, evidence, transaction_at,
       transaction_timestamp_source, settlement_cycle,
       expected_settlement_at, settlement_policy_version,
       settlement_calendar_version, settlement_timing_evidence
     ) VALUES (
       $1,$2,$3,$4,'UPI',1000,1000,NULL,1000,1000,
       'missing_settlement','high','Settlement pending','[]',
       NOW() - INTERVAL '3 days','gateway_capture','T+1',
       NOW() + ($5 * INTERVAL '1 day'),
       'settlement-policy-v1','india-demo-calendar-v1',
       '{"fixture":true}'
     ) RETURNING id`,
    [
      organizationId,
      run.rows[0].id,
      `${label}-ORDER`,
      `${label}-PAY`,
      overdue ? -1 : 1,
    ],
  );

  const actor: Actor = {
    id: user.rows[0].id,
    name: `${label} Admin`,
    role: "admin",
    organizationId,
    organizationName: `Settlement Control ${label}`,
  };
  return { actor, itemId: item.rows[0].id, organizationId };
}

afterEach(async () => {
  while (organizationsToDelete.length) {
    await db.query("DELETE FROM organizations WHERE id = $1", [
      organizationsToDelete.pop(),
    ]);
  }
});

describe("settlement control refresh", () => {
  it("promotes an overdue settlement exactly once and audits each refresh", async () => {
    const tenant = await fixture("overdue", true);

    await expect(refreshSettlementControl(tenant.actor)).resolves.toMatchObject({
      scannedCount: 1,
      createdCount: 1,
    });
    await expect(refreshSettlementControl(tenant.actor)).resolves.toMatchObject({
      scannedCount: 0,
      createdCount: 0,
    });

    const paymentCase = await db.query<{
      case_origin: string;
      count: string;
    }>(
      `SELECT MIN(case_origin) AS case_origin, COUNT(*)::text AS count
       FROM operations_cases
       WHERE organization_id = $1 AND item_id = $2`,
      [tenant.organizationId, tenant.itemId],
    );
    expect(paymentCase.rows[0]).toEqual({
      case_origin: "settlement_overdue",
      count: "1",
    });

    const audits = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM audit_events
       WHERE organization_id = $1
         AND action = 'settlement_control.refreshed'`,
      [tenant.organizationId],
    );
    expect(audits.rows[0].count).toBe("2");
  });

  it("does not promote not-due or cross-tenant settlement items", async () => {
    const tenantA = await fixture("tenant-a", false);
    const tenantB = await fixture("tenant-b", true);

    await expect(refreshSettlementControl(tenantA.actor)).resolves.toMatchObject({
      scannedCount: 0,
      createdCount: 0,
    });

    const cases = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM operations_cases
       WHERE organization_id IN ($1,$2)`,
      [tenantA.organizationId, tenantB.organizationId],
    );
    expect(cases.rows[0].count).toBe("0");
  });
});
