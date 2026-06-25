import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/access";
import { db } from "@/lib/db";
import {
  linkProgramCasesForRun,
} from "@/lib/modules/remediation-programs/repository";
import {
  changeRemediationProgram,
  loadRemediationWorkspace,
  promoteRecurrenceSuggestion,
} from "@/lib/modules/remediation-programs/service";

const organizationsToDelete: string[] = [];

async function fixture(label: string) {
  const slug = `remediation-${label}-${randomUUID()}`;
  const organization = await db.query<{ id: string }>(
    `INSERT INTO organizations (name, slug)
     VALUES ($1,$2) RETURNING id`,
    [`Remediation ${label}`, slug],
  );
  const organizationId = organization.rows[0].id;
  organizationsToDelete.push(organizationId);
  const users = await db.query<{
    id: string;
    name: string;
    role: Actor["role"];
  }>(
    `INSERT INTO users (
       organization_id, name, email, password_hash, role
     ) VALUES
       ($1,$2,$3,'hash','admin'),
       ($1,$4,$5,'hash','analyst'),
       ($1,$6,$7,'hash','viewer')
     RETURNING id, name, role`,
    [
      organizationId,
      `${label} Admin`,
      `${slug}-admin@example.test`,
      `${label} Analyst`,
      `${slug}-analyst@example.test`,
      `${label} Viewer`,
      `${slug}-viewer@example.test`,
    ],
  );
  const actor = (role: Actor["role"]): Actor => {
    const user = users.rows.find((item) => item.role === role)!;
    return {
      id: user.id,
      name: user.name,
      role,
      organizationId,
      organizationName: `Remediation ${label}`,
    };
  };
  const caseIds: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    const run = await insertRun(organizationId, {
      name: `${label} baseline ${index + 1}`,
      createdAt: new Date(Date.now() - (index + 1) * 86_400_000),
      status: "amount_mismatch",
    });
    caseIds.push(run.caseId!);
  }
  return {
    organizationId,
    admin: actor("admin"),
    analyst: actor("analyst"),
    viewer: actor("viewer"),
    caseIds,
  };
}

async function insertRun(
  organizationId: string,
  input: {
    name: string;
    createdAt: Date;
    status: "matched" | "amount_mismatch";
  },
) {
  const run = await db.query<{ id: string }>(
    `INSERT INTO reconciliation_runs (
       organization_id, name, source_type, provider_id, status, total_orders,
       processed_value, matched_value, unmatched_value, matched_count,
       exception_count, match_rate, source_files, created_at
     ) VALUES (
       $1,$2,'upload','razorpay_demo','completed',1,1000,
       $3,$4,$5,$6,$7,'{}',$8
     ) RETURNING id`,
    [
      organizationId,
      input.name,
      input.status === "matched" ? 1000 : 0,
      input.status === "matched" ? 0 : 100,
      input.status === "matched" ? 1 : 0,
      input.status === "matched" ? 0 : 1,
      input.status === "matched" ? 100 : 0,
      input.createdAt,
    ],
  );
  const item = await db.query<{ id: string }>(
    `INSERT INTO reconciliation_items (
       organization_id, run_id, order_id, gateway_reference, payment_mode,
       order_amount, gateway_amount, settled_amount, expected_net, variance,
       reconciliation_status, severity, summary, evidence, created_at
     ) VALUES (
       $1,$2,$3,$4,'UPI',1000,1000,900,900,$5,$6,'medium',$7,'[]',$8
     ) RETURNING id`,
    [
      organizationId,
      run.rows[0].id,
      `ORD-${randomUUID()}`,
      `PAY-${randomUUID()}`,
      input.status === "matched" ? 0 : -100,
      input.status,
      input.status === "matched" ? "Matched" : "Amount mismatch",
      input.createdAt,
    ],
  );
  if (input.status === "matched") {
    return { runId: run.rows[0].id, caseId: null };
  }
  const paymentCase = await db.query<{ id: string }>(
    `INSERT INTO operations_cases (
       organization_id, item_id, run_id, case_status, priority, due_at,
       created_at, updated_at
     ) VALUES (
       $1,$2,$3,'open','medium',
       $4::timestamptz + INTERVAL '24 hours',$4,$4
     ) RETURNING id`,
    [organizationId, item.rows[0].id, run.rows[0].id, input.createdAt],
  );
  return { runId: run.rows[0].id, caseId: paymentCase.rows[0].id };
}

afterEach(async () => {
  while (organizationsToDelete.length) {
    await db.query("DELETE FROM organizations WHERE id = $1", [
      organizationsToDelete.pop(),
    ]);
  }
});

describe("recurring exception remediation programs", () => {
  it("detects, promotes, links future cases, monitors, and verifies two clean runs", async () => {
    const tenant = await fixture("primary");
    const workspace = await loadRemediationWorkspace(
      tenant.organizationId,
      new URLSearchParams(),
    );
    expect(workspace.suggestions).toHaveLength(1);
    expect(workspace.suggestions[0]).toMatchObject({
      providerId: "razorpay_demo",
      paymentMode: "UPI",
      reconciliationStatus: "amount_mismatch",
      caseOrigin: "reconciliation_exception",
      caseCount: 3,
      exposure: 300,
      promoted: false,
    });

    const program = await promoteRecurrenceSuggestion(
      {
        fingerprint: workspace.suggestions[0].fingerprint,
        ownerUserId: tenant.analyst.id,
        remediationPlan:
          "Correct the synthetic fee mapping and monitor subsequent UPI runs.",
        targetDate: "2026-07-15",
      },
      tenant.admin,
    );
    expect(program).toMatchObject({
      status: "active",
      ownerName: tenant.analyst.name,
      baselineCaseCount: 3,
    });
    expect(program?.linkedCases).toHaveLength(3);

    const future = await insertRun(tenant.organizationId, {
      name: "future recurrence",
      createdAt: new Date(),
      status: "amount_mismatch",
    });
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await linkProgramCasesForRun(
        client,
        tenant.organizationId,
        future.runId,
      );
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const linked = await loadRemediationWorkspace(
      tenant.organizationId,
      new URLSearchParams(),
    );
    expect(linked.programs[0].linkedCases).toHaveLength(4);
    expect(
      linked.programs[0].events.some(
        (event) => event.eventType === "case_linked",
      ),
    ).toBe(true);

    await changeRemediationProgram(
      program!.id,
      {
        implementationSummary:
          "Updated the synthetic fee mapping and deployed the corrected normalization rule.",
        implementationEvidenceReference: "change-control/fee-map-v2",
      },
      tenant.analyst,
    );
    const implementedAt = new Date(Date.now() + 60_000);
    await insertRun(tenant.organizationId, {
      name: "clean one",
      createdAt: new Date(implementedAt.getTime() + 60_000),
      status: "matched",
    });
    await insertRun(tenant.organizationId, {
      name: "clean two",
      createdAt: new Date(implementedAt.getTime() + 120_000),
      status: "matched",
    });

    const monitored = await loadRemediationWorkspace(
      tenant.organizationId,
      new URLSearchParams(),
    );
    expect(monitored.programs[0].cleanRuns.slice(-2)).toEqual([
      expect.objectContaining({ clean: true, runName: "clean one" }),
      expect.objectContaining({ clean: true, runName: "clean two" }),
    ]);
    await expect(
      changeRemediationProgram(
        program!.id,
        { action: "verify" },
        tenant.analyst,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      changeRemediationProgram(
        program!.id,
        { action: "verify" },
        tenant.admin,
      ),
    ).resolves.toMatchObject({
      status: "verified",
      verifiedByName: tenant.admin.name,
    });
  });

  it("enforces owner eligibility, tenant isolation, and immutable final states", async () => {
    const tenantA = await fixture("tenant-a");
    const tenantB = await fixture("tenant-b");
    const suggestion = (
      await loadRemediationWorkspace(
        tenantA.organizationId,
        new URLSearchParams(),
      )
    ).suggestions[0];
    await expect(
      promoteRecurrenceSuggestion(
        {
          fingerprint: suggestion.fingerprint,
          ownerUserId: tenantA.viewer.id,
          remediationPlan:
            "Investigate the recurring synthetic mismatch and document remediation.",
          targetDate: "2026-07-15",
        },
        tenantA.admin,
      ),
    ).rejects.toMatchObject({ status: 400 });
    const program = await promoteRecurrenceSuggestion(
      {
        fingerprint: suggestion.fingerprint,
        ownerUserId: tenantA.analyst.id,
        remediationPlan:
          "Investigate the recurring synthetic mismatch and document remediation.",
        targetDate: "2026-07-15",
      },
      tenantA.admin,
    );
    await expect(
      changeRemediationProgram(
        program!.id,
        { action: "abandon", reason: "No longer material after policy review." },
        tenantB.admin,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await changeRemediationProgram(
      program!.id,
      { action: "abandon", reason: "No longer material after policy review." },
      tenantA.admin,
    );
    await expect(
      changeRemediationProgram(
        program!.id,
        { remediationPlan: "This update should not be accepted after closure." },
        tenantA.analyst,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
});
