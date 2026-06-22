import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/access";
import { db } from "@/lib/db";
import {
  changeCloseControl,
  getCloseCertificate,
  loadCloseWorkspace,
  submitCloseControl,
} from "@/lib/modules/close-control/service";

const organizationsToDelete: string[] = [];

async function fixture(label: string) {
  const slug = `close-control-${label}-${randomUUID()}`;
  const organization = await db.query<{ id: string }>(
    `INSERT INTO organizations (name, slug)
     VALUES ($1,$2) RETURNING id`,
    [`Close Control ${label}`, slug],
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
      organizationName: `Close Control ${label}`,
    };
  };
  const run = await db.query<{ id: string }>(
    `INSERT INTO reconciliation_runs (
       organization_id, name, source_type, provider_id, status, total_orders,
       processed_value, matched_value, unmatched_value, matched_count,
       exception_count, match_rate, source_files, created_at
     ) VALUES (
       $1,$2,'upload','razorpay_demo','completed',2,1500,1000,500,1,1,50,
       '{}','2026-06-22T10:00:00.000Z'
     ) RETURNING id`,
    [organizationId, `${label} Daily Close`],
  );
  const items = await db.query<{
    id: string;
    reconciliation_status: string;
  }>(
    `INSERT INTO reconciliation_items (
       organization_id, run_id, order_id, gateway_reference, payment_mode,
       order_amount, gateway_amount, settled_amount, expected_net, variance,
       reconciliation_status, severity, summary, evidence
     ) VALUES
       ($1,$2,$3,$4,'UPI',1000,1000,976.40,976.40,0,
        'matched','low','Matched','[]'),
       ($1,$2,$5,$6,'UPI',500,500,NULL,488.20,488.20,
        'missing_settlement','low','Residual exception','[]')
     RETURNING id, reconciliation_status`,
    [
      organizationId,
      run.rows[0].id,
      `${label}-MATCHED`,
      `${label}-PAY-1`,
      `${label}-OPEN`,
      `${label}-PAY-2`,
    ],
  );
  const openItem = items.rows.find(
    (item) => item.reconciliation_status === "missing_settlement",
  )!;
  const paymentCase = await db.query<{ id: string }>(
    `INSERT INTO operations_cases (
       organization_id, item_id, run_id, priority, due_at
     ) VALUES ($1,$2,$3,'low',NOW() + INTERVAL '24 hours')
     RETURNING id`,
    [organizationId, openItem.id, run.rows[0].id],
  );
  return {
    organizationId,
    admin: actor("admin"),
    analyst: actor("analyst"),
    viewer: actor("viewer"),
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

describe("reconciliation close control", () => {
  it("enforces readiness, dispositions, maker-checker approval, immutable snapshots, and reopen versions", async () => {
    const tenant = await fixture("primary");
    const params = new URLSearchParams({
      date: "2026-06-22",
      provider: "razorpay_demo",
      paymentMode: "UPI",
    });
    const workspace = await loadCloseWorkspace(
      tenant.organizationId,
      params,
    );
    expect(workspace.selected.readiness).toMatchObject({
      runCount: 1,
      itemCount: 2,
      unresolvedCaseCount: 1,
      unresolvedExposure: 488.2,
      ready: false,
    });

    const input = {
      businessDate: "2026-06-22",
      providerId: "razorpay_demo",
      paymentMode: "UPI",
      unresolvedCountThreshold: 1,
      unresolvedAmountThreshold: 500,
      dispositions: [
        {
          caseId: tenant.caseId,
          reason: "Accepted as a monitored residual below close materiality.",
          evidenceConfirmed: true,
        },
      ],
    };
    const submitted = await submitCloseControl(input, tenant.analyst);
    expect(submitted).toMatchObject({
      status: "submitted",
      activeVersion: {
        versionNumber: 1,
        preparedByName: tenant.analyst.name,
      },
    });
    await expect(
      changeCloseControl(
        submitted!.id!,
        { action: "approve" },
        tenant.analyst,
      ),
    ).rejects.toMatchObject({ status: 403 });

    const approved = await changeCloseControl(
      submitted!.id!,
      { action: "approve" },
      tenant.admin,
    );
    expect(approved).toMatchObject({
      status: "approved",
      activeVersion: {
        approvedByName: tenant.admin.name,
      },
    });
    const certificate = await getCloseCertificate(
      submitted!.id!,
      tenant.viewer,
    );
    expect(certificate.period.activeVersion?.snapshotHash).toMatch(
      /^[a-f0-9]{64}$/,
    );
    const firstHash = certificate.period.activeVersion!.snapshotHash;

    await changeCloseControl(
      submitted!.id!,
      {
        action: "reopen",
        reason: "Late settlement evidence requires a corrected close version.",
      },
      tenant.admin,
    );
    const resubmitted = await submitCloseControl(input, tenant.analyst);
    expect(resubmitted?.activeVersion).toMatchObject({
      versionNumber: 2,
    });
    expect(firstHash).toBe(
      certificate.period.activeVersion!.snapshotHash,
    );

    const audits = await db.query<{ action: string }>(
      `SELECT action FROM audit_events
       WHERE organization_id = $1
         AND action LIKE 'reconciliation_close.%'
       ORDER BY created_at`,
      [tenant.organizationId],
    );
    expect(audits.rows.map((item) => item.action)).toEqual([
      "reconciliation_close.submitted",
      "reconciliation_close.approved",
      "reconciliation_close.reopened",
      "reconciliation_close.submitted",
    ]);
  });

  it("rejects cross-tenant close access and self-approval", async () => {
    const tenantA = await fixture("tenant-a");
    const tenantB = await fixture("tenant-b");
    const submitted = await submitCloseControl(
      {
        businessDate: "2026-06-22",
        providerId: "razorpay_demo",
        paymentMode: "UPI",
        unresolvedCountThreshold: 1,
        unresolvedAmountThreshold: 500,
        dispositions: [
          {
            caseId: tenantA.caseId,
            reason: "Accepted as a monitored residual below close materiality.",
            evidenceConfirmed: true,
          },
        ],
      },
      tenantA.admin,
    );
    await expect(
      changeCloseControl(
        submitted!.id!,
        { action: "approve" },
        tenantA.admin,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      changeCloseControl(
        submitted!.id!,
        { action: "approve" },
        tenantB.admin,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      getCloseCertificate(submitted!.id!, tenantB.viewer),
    ).rejects.toMatchObject({ status: 404 });
  });
});
