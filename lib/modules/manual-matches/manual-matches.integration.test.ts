import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/access";
import { db } from "@/lib/db";
import { listCases } from "@/lib/modules/cases/repository";
import { changeCase } from "@/lib/modules/cases/service";
import {
  decideManualUnmatch,
  proposeManualMatch,
  proposeManualUnmatch,
} from "@/lib/modules/manual-matches/service";

const organizationsToDelete: string[] = [];

type FixtureItem = {
  itemId: string;
  runId: string;
  caseId: string;
};

async function fixture(label: string) {
  const slug = `manual-matches-${label}-${randomUUID()}`;
  const organization = await db.query<{ id: string }>(
    `INSERT INTO organizations (name, slug)
     VALUES ($1,$2) RETURNING id`,
    [`Manual Matches ${label}`, slug],
  );
  const organizationId = organization.rows[0].id;
  organizationsToDelete.push(organizationId);

  const adminProposer = await db.query<{ id: string }>(
    `INSERT INTO users (organization_id, name, email, password_hash, role)
     VALUES ($1,'Admin Proposer',$2,'test-hash','admin')
     RETURNING id`,
    [organizationId, `admin-proposer-${slug}@example.test`],
  );
  const adminApprover = await db.query<{ id: string }>(
    `INSERT INTO users (organization_id, name, email, password_hash, role)
     VALUES ($1,'Admin Approver',$2,'test-hash','admin')
     RETURNING id`,
    [organizationId, `admin-approver-${slug}@example.test`],
  );
  const analyst = await db.query<{ id: string }>(
    `INSERT INTO users (organization_id, name, email, password_hash, role)
     VALUES ($1,'Analyst',$2,'test-hash','analyst')
     RETURNING id`,
    [organizationId, `analyst-${slug}@example.test`],
  );

  const run = await db.query<{ id: string }>(
    `INSERT INTO reconciliation_runs (
       organization_id, name, source_type, provider_id, total_orders,
       processed_value, matched_value, unmatched_value, matched_count,
       exception_count, match_rate, source_files
     ) VALUES ($1,$2,'upload','generic',2,2000,1000,1000,1,1,50,'{}')
     RETURNING id`,
    [organizationId, `${label} Run`],
  );
  const runId = run.rows[0].id;

  const mismatchItem = await insertItemAndCase(
    organizationId,
    runId,
    `${label}-MISMATCH`,
    "amount_mismatch",
    "unmatched",
    "none",
  );
  const matchedItem = await insertItemAndCase(
    organizationId,
    runId,
    `${label}-MATCHED`,
    "matched",
    "exact_order_id",
    "exact",
  );

  const proposer: Actor = {
    id: adminProposer.rows[0].id,
    name: "Admin Proposer",
    role: "admin",
    organizationId,
    organizationName: `Manual Matches ${label}`,
  };
  const approver: Actor = { ...proposer, id: adminApprover.rows[0].id, name: "Admin Approver" };
  const analystActor: Actor = {
    ...proposer,
    id: analyst.rows[0].id,
    name: "Analyst",
    role: "analyst",
  };

  return {
    organizationId,
    runId,
    mismatchItem,
    matchedItem,
    proposer,
    approver,
    analyst: analystActor,
  };
}

async function insertItemAndCase(
  organizationId: string,
  runId: string,
  label: string,
  reconciliationStatus: string,
  matchStrategy: string,
  matchConfidence: string,
): Promise<FixtureItem> {
  const item = await db.query<{ id: string }>(
    `INSERT INTO reconciliation_items (
       organization_id, run_id, order_id, gateway_reference, payment_mode,
       order_amount, gateway_amount, settled_amount, expected_net, variance,
       reconciliation_status, severity, summary, evidence,
       match_strategy, match_confidence
     ) VALUES (
       $1,$2,$3,$4,'UPI',1000,1000,1000,990,0,
       $5,'medium','Synthetic test item.','[]',$6,$7
     ) RETURNING id`,
    [
      organizationId,
      runId,
      `${label}-ORDER`,
      `${label}-PAY`,
      reconciliationStatus,
      matchStrategy,
      matchConfidence,
    ],
  );
  const itemId = item.rows[0].id;
  const paymentCase = await db.query<{ id: string }>(
    `INSERT INTO operations_cases (
       organization_id, item_id, run_id, priority, due_at
     ) VALUES (
       $1,$2,$3,'medium',NOW() + INTERVAL '24 hours'
     ) RETURNING id`,
    [organizationId, itemId, runId],
  );
  await db.query(
    `INSERT INTO reconciliation_source_evidence (
       organization_id, run_id, item_id, source_type, row_number,
       normalized_values, source_values, integrity_hash
     ) VALUES (
       $1,$2,$3,'orders',1,
       '{"orderId":"ORD"}','{"orderId":"ORD"}',
       repeat('a', 64)
     )`,
    [organizationId, runId, itemId],
  );
  return { itemId, runId, caseId: paymentCase.rows[0].id };
}

afterEach(async () => {
  while (organizationsToDelete.length) {
    await db.query("DELETE FROM organizations WHERE id = $1", [
      organizationsToDelete.pop(),
    ]);
  }
});

describe("manual match override desk", () => {
  it("applies a manual match in one step, persists audit, surfaces effective state on the case", async () => {
    const tenant = await fixture("apply");
    const result = await proposeManualMatch({
      actor: tenant.analyst,
      itemId: tenant.mismatchItem.itemId,
      reason: "UTR-123 ties out against bank credit BNK-501 in the import sheet.",
      evidenceConfirmed: true,
    });
    expect(result.proposal).toMatchObject({
      proposalType: "manual_match",
      status: "applied",
      proposedByName: "Analyst",
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].eventType).toBe("manual_match_applied");

    const cases = await listCases(tenant.organizationId);
    const surfaced = cases.find((c) => c.id === tenant.mismatchItem.caseId);
    expect(surfaced?.manualOverride).toMatchObject({
      status: "applied",
      proposalType: "manual_match",
    });
    expect(surfaced?.engineMatchStrategy).toBe("unmatched");

    const audit = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM audit_events
       WHERE organization_id = $1 AND action = 'manual_match.applied'`,
      [tenant.organizationId],
    );
    expect(Number(audit.rows[0].count)).toBe(1);
  });

  it("routes a manual unmatch through maker-checker and rejects same-user approvals", async () => {
    const tenant = await fixture("maker-checker");
    const proposed = await proposeManualUnmatch({
      actor: tenant.proposer,
      itemId: tenant.matchedItem.itemId,
      reason: "Engine match is wrong — duplicate gateway payment posted twice.",
      evidenceConfirmed: true,
    });
    expect(proposed.proposal.status).toBe("proposed");

    await expect(
      decideManualUnmatch({
        actor: tenant.proposer,
        proposalId: proposed.proposal.id,
        action: "approve",
        decisionReason: "Maker cannot approve own proposal.",
      }),
    ).rejects.toThrow("different administrator");

    await expect(
      decideManualUnmatch({
        actor: tenant.analyst,
        proposalId: proposed.proposal.id,
        action: "approve",
        decisionReason: "Analyst should not be allowed to approve.",
      }),
    ).rejects.toThrow("administrators");

    const approved = await decideManualUnmatch({
      actor: tenant.approver,
      proposalId: proposed.proposal.id,
      action: "approve",
      decisionReason: "Reviewed duplicate payment lineage — engine match is invalid.",
    });
    expect(approved.proposal.status).toBe("approved");
    expect(approved.events.map((e) => e.eventType)).toEqual([
      "manual_unmatch_proposed",
      "manual_unmatch_approved",
    ]);

    const audit = await db.query<{ action: string }>(
      `SELECT action FROM audit_events
       WHERE organization_id = $1 AND entity_type = 'manual_match_proposal'
       ORDER BY created_at ASC`,
      [tenant.organizationId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      "manual_match.proposed_unmatch",
      "manual_match.approved",
    ]);
  });

  it("isolates overrides across organizations and allows the same item_id in both", async () => {
    const tenantA = await fixture("org-a");
    const tenantB = await fixture("org-b");

    await proposeManualMatch({
      actor: tenantA.analyst,
      itemId: tenantA.mismatchItem.itemId,
      reason: "Tenant A is overriding their own mismatch case.",
      evidenceConfirmed: true,
    });

    const tenantBCases = await listCases(tenantB.organizationId);
    for (const item of tenantBCases) {
      expect(item.manualOverride).toBeNull();
    }

    await expect(
      decideManualUnmatch({
        actor: tenantB.approver,
        proposalId: (
          await db.query<{ id: string }>(
            `SELECT id FROM manual_match_proposals WHERE organization_id = $1 LIMIT 1`,
            [tenantA.organizationId],
          )
        ).rows[0].id,
        action: "approve",
        decisionReason: "Tenant B should not see Tenant A's proposal.",
      }),
    ).rejects.toThrow("not found");
  });

  it("blocks case resolution while a manual unmatch is still proposed", async () => {
    const tenant = await fixture("resolution-guard");
    await proposeManualUnmatch({
      actor: tenant.proposer,
      itemId: tenant.matchedItem.itemId,
      reason: "Awaiting admin decision before finance can close this case.",
      evidenceConfirmed: true,
    });

    await expect(
      changeCase(
        tenant.matchedItem.caseId,
        {
          status: "resolved",
          resolutionReason: "Closing while unmatch pending should fail.",
          resolutionEvidenceConfirmed: true,
        },
        tenant.proposer,
      ),
    ).rejects.toThrow("pending manual unmatch");
  });

  it("allows a fresh manual match after an approved unmatch (partial unique index excludes approved)", async () => {
    const tenant = await fixture("re-match");
    const proposal = await proposeManualUnmatch({
      actor: tenant.proposer,
      itemId: tenant.matchedItem.itemId,
      reason: "Initial unmatch — engine matched a refund as collection.",
      evidenceConfirmed: true,
    });
    await decideManualUnmatch({
      actor: tenant.approver,
      proposalId: proposal.proposal.id,
      action: "approve",
      decisionReason: "Confirmed refund mis-categorized — unmatch approved.",
    });

    // Item's underlying engine state is still 'matched' (we don't restamp);
    // so a new manual_unmatch should be proposable on top of the historical
    // approved row without colliding on the partial unique index.
    const second = await proposeManualUnmatch({
      actor: tenant.proposer,
      itemId: tenant.matchedItem.itemId,
      reason: "Re-proposing — newly discovered upstream provider replay.",
      evidenceConfirmed: true,
    });
    expect(second.proposal.status).toBe("proposed");

    const proposals = await db.query<{ status: string }>(
      `SELECT status FROM manual_match_proposals
       WHERE organization_id = $1 AND item_id = $2
       ORDER BY created_at ASC`,
      [tenant.organizationId, tenant.matchedItem.itemId],
    );
    expect(proposals.rows.map((r) => r.status)).toEqual([
      "approved",
      "proposed",
    ]);
  });
});
