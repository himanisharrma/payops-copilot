import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/access";
import { db } from "@/lib/db";
import { listAuditEvents } from "@/lib/modules/audit/repository";
import {
  decideSourceIngestionVersion,
  loadSourceIngestionVersion,
  loadSourceReadinessSnapshots,
  persistSourceReadinessSnapshot,
  registerSourceExpectation,
  uploadSourceFile,
} from "@/lib/modules/source-ingestion/service";

const organizationsToDelete: string[] = [];

async function createActor(label: string): Promise<Actor> {
  const slug = `source-ingestion-${label}-${randomUUID()}`;
  const organization = await db.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1,$2) RETURNING id`,
    [`Source ingestion ${label}`, slug],
  );
  organizationsToDelete.push(organization.rows[0].id);
  const user = await db.query<{ id: string }>(
    `INSERT INTO users (organization_id, name, email, password_hash, role)
     VALUES ($1,$2,$3,'integration-hash','admin') RETURNING id`,
    [organization.rows[0].id, `${label} Admin`, `${slug}@example.test`],
  );
  return {
    id: user.rows[0].id,
    name: `${label} Admin`,
    role: "admin",
    organizationId: organization.rows[0].id,
    organizationName: `Source ingestion ${label}`,
  };
}

async function createQuarantinedVersion(actor: Actor, businessDate = "2026-06-27") {
  const expectation = await registerSourceExpectation({
    actor,
    sourceKey: `bank-${randomUUID()}`,
    displayName: "Synthetic bank statement",
    providerId: "bank_demo",
    sourceKind: "bank_statement",
    transportType: "manual_upload",
    businessDate,
    expectedArrivalAt: `${businessDate}T09:00:00.000Z`,
    graceMinutes: 60,
    requiredForClose: true,
    expectedFilenamePattern: "bank-*.csv",
    ownerTeam: "Treasury operations",
  });
  const upload = await uploadSourceFile({
    actor,
    expectationId: expectation.expectationId,
    filename: "bank-partial.csv",
    csvText: "bank_reference,utr,amount,credited_at\nBANK-1,UTR-1,100,2026-06-27",
    receivedAt: `${businessDate}T08:30:00.000Z`,
  });
  expect(upload.validationStatus).toBe("needs_review");
  return { ...expectation, ...upload };
}

afterEach(async () => {
  while (organizationsToDelete.length) {
    await db.query("DELETE FROM organizations WHERE id = $1", [
      organizationsToDelete.pop(),
    ]);
  }
});

describe("source ingestion review and readiness", () => {
  it("org-scopes detail reads and records an audited immutable acceptance", async () => {
    const actorA = await createActor("A");
    const actorB = await createActor("B");
    const version = await createQuarantinedVersion(actorA);
    const duplicate = await uploadSourceFile({
      actor: actorA,
      expectationId: version.expectationId,
      filename: "bank-partial-copy.csv",
      csvText: "bank_reference,utr,amount,credited_at\nBANK-1,UTR-1,100,2026-06-27",
      receivedAt: "2026-06-27T08:35:00.000Z",
    });
    expect(duplicate).toMatchObject({
      classification: "duplicate",
      validationStatus: "rejected",
    });

    await expect(loadSourceIngestionVersion(version.arrivalId, actorB.organizationId))
      .resolves.toBeNull();
    const viewer = { ...actorA, role: "viewer" as const, name: "Read-only viewer" };
    await expect(loadSourceIngestionVersion(version.arrivalId, viewer.organizationId))
      .resolves.toMatchObject({ arrival: { id: version.arrivalId } });
    await expect(decideSourceIngestionVersion({
      actor: viewer,
      arrivalId: version.arrivalId,
      action: "accept",
      reason: "Viewer must not be able to release a quarantined file.",
    })).rejects.toMatchObject({ status: 403 });

    const accepted = await decideSourceIngestionVersion({
      actor: actorA,
      arrivalId: version.arrivalId,
      action: "accept",
      reason: "Reviewed synthetic partial extract and approved its complete business scope.",
    });
    expect(accepted).toMatchObject({
      validationStatus: "accepted",
      acceptedRowCount: 1,
      rejectedRowCount: 0,
      downstreamWorkflow: "close_control",
    });

    const detail = await loadSourceIngestionVersion(version.arrivalId, actorA.organizationId);
    expect(detail?.lineage.map((item) => item.versionNumber)).toEqual([2, 1]);
    expect(detail?.events.map((event) => event.eventType)).toContain("file_accepted");
    expect(detail?.arrival.review?.reviewedByUserId).toBe(actorA.id);
    expect((await listAuditEvents(actorA.organizationId)).map((event) => event.action))
      .toContain("source_ingestion.file_accepted");

    await expect(decideSourceIngestionVersion({
      actor: actorA,
      arrivalId: version.arrivalId,
      action: "reject",
      reason: "Attempt to reverse accepted evidence.",
    })).rejects.toMatchObject({ status: 409 });
    await expect(db.query(
      `UPDATE source_ingestion_arrivals SET file_name = 'changed.csv'
       WHERE organization_id = $1 AND id = $2`,
      [actorA.organizationId, version.arrivalId],
    )).rejects.toMatchObject({ code: "23514" });
  });

  it("persists point-in-time blockers and isolates snapshot history", async () => {
    const actorA = await createActor("snapshot-A");
    const actorB = await createActor("snapshot-B");
    const version = await createQuarantinedVersion(actorA);

    const blocked = await persistSourceReadinessSnapshot({
      actor: actorA,
      businessDate: "2026-06-27",
    });
    expect(blocked).toMatchObject({ verdict: "blocked", blockingFiles: 1 });
    expect(blocked.blockingExpectationIds).toEqual([version.expectationId]);

    await decideSourceIngestionVersion({
      actor: actorA,
      arrivalId: version.arrivalId,
      action: "accept",
      reason: "Validated as the complete synthetic statement for this test date.",
    });
    const ready = await persistSourceReadinessSnapshot({
      actor: actorA,
      businessDate: "2026-06-27",
    });
    expect(ready).toMatchObject({ verdict: "ready", blockingFiles: 0 });
    expect(ready.blockingExpectationIds).toEqual([]);

    const snapshots = await loadSourceReadinessSnapshots(
      actorA.organizationId,
      new URLSearchParams({ businessDate: "2026-06-27" }),
    );
    expect(snapshots.map((snapshot) => snapshot.verdict)).toEqual(["ready", "blocked"]);
    await expect(loadSourceReadinessSnapshots(
      actorB.organizationId,
      new URLSearchParams({ businessDate: "2026-06-27" }),
    )).resolves.toEqual([]);
  });
});
