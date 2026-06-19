import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { db, transaction } from "@/lib/db";
import {
  listAuditEvents,
  recordAuditEvent,
} from "@/lib/modules/audit/repository";
import {
  getCase,
  listCases,
  updateCase,
} from "@/lib/modules/cases/repository";

type TenantFixture = {
  organizationId: string;
  userId: string;
  runId: string;
  itemId: string;
  caseId: string;
};

const organizationsToDelete: string[] = [];

async function createTenant(label: string): Promise<TenantFixture> {
  const slug = `integration-${label}-${randomUUID()}`;
  const organization = await db.query<{ id: string }>(
    `INSERT INTO organizations (name, slug)
     VALUES ($1, $2)
     RETURNING id`,
    [`Integration ${label}`, slug],
  );
  const organizationId = organization.rows[0].id;
  organizationsToDelete.push(organizationId);

  const user = await db.query<{ id: string }>(
    `INSERT INTO users (
       organization_id, name, email, password_hash, role
     ) VALUES ($1,$2,$3,$4,'admin')
     RETURNING id`,
    [
      organizationId,
      `${label} Admin`,
      `${slug}@example.test`,
      "integration-test-password-hash",
    ],
  );

  const run = await db.query<{ id: string }>(
    `INSERT INTO reconciliation_runs (
       organization_id, name, source_type, total_orders, processed_value,
       matched_value, unmatched_value, matched_count, exception_count,
       match_rate, source_files
     ) VALUES ($1,$2,'upload',1,1000,0,1000,0,1,0,'{}'::jsonb)
     RETURNING id`,
    [organizationId, `${label} Run`],
  );

  const item = await db.query<{ id: string }>(
    `INSERT INTO reconciliation_items (
       organization_id, run_id, order_id, gateway_reference, payment_mode,
       order_amount, gateway_amount, settled_amount, expected_net, variance,
       reconciliation_status, severity, summary, evidence
     ) VALUES (
       $1,$2,$3,$4,'UPI',1000,1000,900,990,-90,
       'amount_mismatch','high','Integration mismatch','["Evidence"]'::jsonb
     )
     RETURNING id`,
    [organizationId, run.rows[0].id, `${label}-ORDER`, `${label}-PAYMENT`],
  );

  await db.query(
    `INSERT INTO reconciliation_source_evidence (
       organization_id, run_id, item_id, source_type, row_number,
       normalized_values, source_values, integrity_hash
     ) VALUES (
       $1,$2,$3,'orders',1,$4::jsonb,$5::jsonb,$6
     )`,
    [
      organizationId,
      run.rows[0].id,
      item.rows[0].id,
      JSON.stringify({ orderId: `${label}-ORDER`, amount: 1000 }),
      JSON.stringify({ order_id: `${label}-ORDER`, amount: 1000 }),
      "a".repeat(64),
    ],
  );

  const paymentCase = await db.query<{ id: string }>(
    `INSERT INTO operations_cases (
       organization_id, item_id, run_id, priority, due_at
     ) VALUES ($1,$2,$3,'high',NOW() + INTERVAL '4 hours')
     RETURNING id`,
    [organizationId, item.rows[0].id, run.rows[0].id],
  );

  return {
    organizationId,
    userId: user.rows[0].id,
    runId: run.rows[0].id,
    itemId: item.rows[0].id,
    caseId: paymentCase.rows[0].id,
  };
}

afterEach(async () => {
  while (organizationsToDelete.length) {
    await db.query("DELETE FROM organizations WHERE id = $1", [
      organizationsToDelete.pop(),
    ]);
  }
});

describe("organization isolation", () => {
  it("returns only cases owned by the requested organization", async () => {
    const tenantA = await createTenant("A");
    const tenantB = await createTenant("B");

    const cases = await listCases(tenantA.organizationId);
    expect(cases.map((paymentCase) => paymentCase.id)).toContain(tenantA.caseId);
    expect(cases.map((paymentCase) => paymentCase.id)).not.toContain(
      tenantB.caseId,
    );
    await expect(
      getCase(tenantB.caseId, tenantA.organizationId),
    ).resolves.toBeNull();
  });

  it("prevents cross-organization updates and audit reads", async () => {
    const tenantA = await createTenant("A");
    const tenantB = await createTenant("B");
    await recordAuditEvent({
      organizationId: tenantB.organizationId,
      actorUserId: tenantB.userId,
      actorName: "B Admin",
      action: "integration.hidden",
      entityType: "operations_case",
      entityId: tenantB.caseId,
    });

    const client = await db.connect();
    try {
      await expect(
        updateCase(client, tenantB.caseId, tenantA.organizationId, {
          notes: "Cross-tenant write",
        }),
      ).resolves.toBeNull();
    } finally {
      client.release();
    }

    expect(
      (await listAuditEvents(tenantA.organizationId)).some(
        (event) => event.action === "integration.hidden",
      ),
    ).toBe(false);
  });

  it("rejects a case that mixes tenant-owned run and item records", async () => {
    const tenantA = await createTenant("A");
    const tenantB = await createTenant("B");
    await db.query("DELETE FROM operations_cases WHERE id = $1", [
      tenantB.caseId,
    ]);

    await expect(
      db.query(
        `INSERT INTO operations_cases (
           organization_id, item_id, run_id, priority, due_at
         ) VALUES ($1,$2,$3,'high',NOW() + INTERVAL '4 hours')`,
        [tenantA.organizationId, tenantB.itemId, tenantB.runId],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("rolls back a case mutation and its audit event together", async () => {
    const tenant = await createTenant("rollback");

    await expect(
      transaction(async (client: PoolClient) => {
        await updateCase(client, tenant.caseId, tenant.organizationId, {
          notes: "This must roll back",
        });
        await recordAuditEvent(
          {
            organizationId: tenant.organizationId,
            actorUserId: tenant.userId,
            actorName: "Rollback Admin",
            action: "integration.rollback",
            entityType: "operations_case",
            entityId: tenant.caseId,
          },
          client,
        );
        throw new Error("Force rollback");
      }),
    ).rejects.toThrow("Force rollback");

    expect(
      (await getCase(tenant.caseId, tenant.organizationId))?.notes,
    ).toBe("");
    expect(
      (await listAuditEvents(tenant.organizationId)).some(
        (event) => event.action === "integration.rollback",
      ),
    ).toBe(false);
  });
});
