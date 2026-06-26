import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/access";
import { db } from "@/lib/db";
import {
  changeSettlementAdjustment,
  createSettlementImport,
  getSettlementImportDetail,
  loadSettlementImportWorkspace,
  proposeSettlementAdjustment,
} from "@/lib/modules/settlement-imports/service";

const organizationsToDelete: string[] = [];

async function fixture(label: string) {
  const slug = `settlement-imports-${label}-${randomUUID()}`;
  const organization = await db.query<{ id: string }>(
    `INSERT INTO organizations (name, slug)
     VALUES ($1,$2) RETURNING id`,
    [`Settlement Imports ${label}`, slug],
  );
  const organizationId = organization.rows[0].id;
  organizationsToDelete.push(organizationId);

  const adminUser = await db.query<{ id: string }>(
    `INSERT INTO users (organization_id, name, email, password_hash, role)
     VALUES ($1,'Admin Maker',$2,'test-hash','admin')
     RETURNING id`,
    [organizationId, `admin-maker-${slug}@example.test`],
  );
  const checkerUser = await db.query<{ id: string }>(
    `INSERT INTO users (organization_id, name, email, password_hash, role)
     VALUES ($1,'Admin Checker',$2,'test-hash','admin')
     RETURNING id`,
    [organizationId, `admin-checker-${slug}@example.test`],
  );
  const viewerUser = await db.query<{ id: string }>(
    `INSERT INTO users (organization_id, name, email, password_hash, role)
     VALUES ($1,'Viewer',$2,'test-hash','viewer')
     RETURNING id`,
    [organizationId, `viewer-${slug}@example.test`],
  );
  const merchant = await db.query<{ id: string }>(
    `INSERT INTO merchant_accounts (organization_id, merchant_reference, display_name)
     VALUES ($1,'merchant-demo','Demo Merchant') RETURNING id`,
    [organizationId],
  );
  const batch = await db.query<{ id: string }>(
    `INSERT INTO merchant_settlement_batches (
       organization_id, merchant_account_id, statement_reference, provider_id,
       payment_mode, settlement_cycle, status, utr, expected_settlement_at,
       actual_settlement_at, gross_amount, deduction_amount, net_amount,
       bank_credit_amount, variance_amount, utr_match_status,
       classification_evidence
     ) VALUES (
       $1,$2,'STMT-001','generic','UPI','T+1','credited','UTR-001',
       '2026-06-21T12:30:00Z','2026-06-21T13:00:00Z',
       1000,20,980,980,0,'matched','{"fixture":true}'
     ) RETURNING id`,
    [organizationId, merchant.rows[0].id],
  );
  await db.query(
    `INSERT INTO merchant_settlement_lines (
       organization_id, batch_id, order_id, gateway_reference,
       payment_mode, gross_amount, deduction_amount, net_amount,
       line_status, evidence
     ) VALUES ($1,$2,'ORD-001','PAY-001','UPI',1000,20,980,'included','{"fixture":true}')`,
    [organizationId, batch.rows[0].id],
  );
  await db.query(
    `INSERT INTO merchant_settlement_bank_credits (
       organization_id, batch_id, utr, amount, credited_at,
       bank_reference, match_status, evidence
     ) VALUES ($1,$2,'UTR-001',980,'2026-06-21T13:00:00Z','BANK-001','matched','{"fixture":true}')`,
    [organizationId, batch.rows[0].id],
  );

  const actor: Actor = {
    id: adminUser.rows[0].id,
    name: "Admin Maker",
    role: "admin",
    organizationId,
    organizationName: `Settlement Imports ${label}`,
  };
  const checker: Actor = {
    ...actor,
    id: checkerUser.rows[0].id,
    name: "Admin Checker",
  };
  const viewer: Actor = {
    ...actor,
    id: viewerUser.rows[0].id,
    name: "Viewer",
    role: "viewer",
  };
  return { actor, checker, viewer, organizationId };
}

afterEach(async () => {
  while (organizationsToDelete.length) {
    await db.query("DELETE FROM organizations WHERE id = $1", [
      organizationsToDelete.pop(),
    ]);
  }
});

describe("settlement import exception desk", () => {
  it("creates idempotent imports, compares rows, and keeps reads tenant scoped", async () => {
    const tenant = await fixture("tenant-a");
    const otherTenant = await fixture("tenant-b");
    const csv = `statement_reference,merchant_reference,order_id,gateway_reference,payment_mode,gross_amount,deduction_amount,deduction_type,utr,settlement_status
STMT-001,merchant-demo,ORD-001,PAY-001,UPI,1000,20,mdr,UTR-001,credited`;

    const first = await createSettlementImport({
      actor: tenant.actor,
      providerId: "generic",
      filename: "fixture.csv",
      csvText: csv,
    });
    const second = await createSettlementImport({
      actor: tenant.actor,
      providerId: "generic",
      filename: "fixture.csv",
      csvText: csv,
    });

    expect(second.importBatchId).toBe(first.importBatchId);
    expect(second).toMatchObject({ comparedRows: 1, matchedRows: 1, exceptionCount: 0 });

    const workspace = await loadSettlementImportWorkspace(
      tenant.organizationId,
      new URLSearchParams(),
    );
    expect(workspace.summary).toMatchObject({
      imports: 1,
      importedRows: 1,
      matchedRows: 1,
      openExceptions: 0,
    });
    await expect(
      getSettlementImportDetail(first.importBatchId, otherTenant.organizationId),
    ).resolves.toBeNull();
  });

  it("enforces maker/checker approvals on adjustment records", async () => {
    const tenant = await fixture("maker-checker");
    const csv = `statement_reference,merchant_reference,order_id,gateway_reference,payment_mode,gross_amount,deduction_amount,deduction_type,utr,settlement_status
STMT-001,merchant-demo,ORD-001,PAY-001,UPI,1010,20,mdr,UTR-001,credited`;

    const created = await createSettlementImport({
      actor: tenant.actor,
      providerId: "generic",
      filename: "amount-mismatch.csv",
      csvText: csv,
    });
    const detail = await getSettlementImportDetail(
      created.importBatchId,
      tenant.organizationId,
    );
    const exception = detail?.exceptions[0];
    expect(exception?.exceptionType).toBe("amount_mismatch");

    const proposal = await proposeSettlementAdjustment({
      actor: tenant.actor,
      exceptionId: exception!.id,
      adjustmentType: "manual_review",
      amount: 10,
      reason: "Synthetic amount mismatch requires maker checker review.",
      evidenceReference: "fixture:evidence",
    });

    await expect(
      changeSettlementAdjustment({
        actor: tenant.actor,
        adjustmentId: proposal.adjustmentId,
        action: "approve",
        reason: "Maker cannot approve own proposal.",
      }),
    ).rejects.toThrow("different administrator");

    await expect(
      changeSettlementAdjustment({
        actor: tenant.viewer,
        adjustmentId: proposal.adjustmentId,
        action: "approve",
        reason: "Viewer cannot approve this adjustment.",
      }),
    ).rejects.toThrow("Only administrators");

    await expect(
      changeSettlementAdjustment({
        actor: tenant.checker,
        adjustmentId: proposal.adjustmentId,
        action: "approve",
        reason: "Independent synthetic checker approves controlled record.",
      }),
    ).resolves.toMatchObject({ status: "approved" });
  });
});
