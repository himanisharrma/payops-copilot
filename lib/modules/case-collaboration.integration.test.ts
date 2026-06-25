import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  bulkAssignCases,
  createCaseComment,
  listCaseComments,
} from "@/lib/modules/cases/repository";
import { assignCases } from "@/lib/modules/cases/service";
import type { Actor } from "@/lib/access";

const organizationsToDelete: string[] = [];

async function fixture(label: string) {
  const slug = `collaboration-${label}-${randomUUID()}`;
  const organization = await db.query<{ id: string }>(
    `INSERT INTO organizations (name, slug)
     VALUES ($1, $2) RETURNING id`,
    [`Collaboration ${label}`, slug],
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
       reconciliation_status, severity, summary, evidence
     ) VALUES (
       $1,$2,$3,$4,'UPI',1000,1000,900,990,-90,
       'amount_mismatch','high','Mismatch','[]'
     ) RETURNING id`,
    [organizationId, run.rows[0].id, `${label}-ORDER`, `${label}-PAY`],
  );
  const paymentCase = await db.query<{ id: string }>(
    `INSERT INTO operations_cases (
       organization_id, item_id, run_id, priority, due_at
     ) VALUES ($1,$2,$3,'high',NOW() + INTERVAL '4 hours')
     RETURNING id`,
    [organizationId, item.rows[0].id, run.rows[0].id],
  );
  const actor: Actor = {
    id: user.rows[0].id,
    name: `${label} Admin`,
    role: "admin",
    organizationId,
    organizationName: `Collaboration ${label}`,
  };
  return { organizationId, userId: user.rows[0].id, caseId: paymentCase.rows[0].id, actor };
}

afterEach(async () => {
  while (organizationsToDelete.length) {
    await db.query("DELETE FROM organizations WHERE id = $1", [
      organizationsToDelete.pop(),
    ]);
  }
});

describe("case collaboration", () => {
  it("assigns and comments atomically within one organization", async () => {
    const tenant = await fixture("primary");
    await expect(
      assignCases(
        { caseIds: [tenant.caseId], owner: "Queue Lead" },
        tenant.actor,
      ),
    ).resolves.toMatchObject({
      updatedIds: [tenant.caseId],
      owner: "Queue Lead",
    });

    const client = await db.connect();
    try {
      const comment = await createCaseComment(client, {
        caseId: tenant.caseId,
        organizationId: tenant.organizationId,
        authorUserId: tenant.userId,
        authorName: tenant.actor.name,
        body: "Provider trace requested before the next handoff.",
      });
      expect(comment?.authorName).toBe(tenant.actor.name);
    } finally {
      client.release();
    }
    await expect(
      listCaseComments(tenant.caseId, tenant.organizationId),
    ).resolves.toHaveLength(1);
  });

  it("rejects cross-tenant bulk updates and hides comments", async () => {
    const tenantA = await fixture("A");
    const tenantB = await fixture("B");
    const client = await db.connect();
    try {
      await expect(
        bulkAssignCases(
          client,
          [tenantB.caseId],
          tenantA.organizationId,
          "Wrong tenant",
        ),
      ).resolves.toEqual([]);
      await createCaseComment(client, {
        caseId: tenantB.caseId,
        organizationId: tenantB.organizationId,
        authorUserId: tenantB.userId,
        authorName: tenantB.actor.name,
        body: "Tenant B only.",
      });
    } finally {
      client.release();
    }
    await expect(
      listCaseComments(tenantB.caseId, tenantA.organizationId),
    ).resolves.toEqual([]);
    await expect(
      assignCases(
        { caseIds: [tenantB.caseId], owner: "Wrong tenant" },
        tenantA.actor,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});
