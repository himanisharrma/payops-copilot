import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  getOperationalNotifications,
  readOperationalNotification,
} from "@/lib/modules/notifications/service";
import { listPaymentWorkflows } from "@/lib/modules/payment-workflows/repository";
import { listPersistedProviderEvents } from "@/lib/modules/provider-events/repository";
import {
  receiveSyntheticProviderWebhook,
  syntheticWebhookSignature,
} from "@/lib/modules/provider-events/service";
import type { Actor } from "@/lib/access";

type Fixture = {
  organizationId: string;
  organizationSlug: string;
  admin: Actor;
  viewer: Actor;
  workflowId: string;
  caseId: string;
};

const organizationsToDelete: string[] = [];
const previousSecret = process.env.SYNTHETIC_WEBHOOK_SECRET;

async function createFixture(label: string): Promise<Fixture> {
  const organizationSlug = `webhook-${label}-${randomUUID()}`;
  const organization = await db.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1,$2) RETURNING id`,
    [`Webhook ${label}`, organizationSlug],
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
       ($1,$4,$5,'hash','viewer')
     RETURNING id, name, role`,
    [
      organizationId,
      `${label} Admin`,
      `${organizationSlug}-admin@example.test`,
      `${label} Viewer`,
      `${organizationSlug}-viewer@example.test`,
    ],
  );
  const adminUser = users.rows.find((user) => user.role === "admin")!;
  const viewerUser = users.rows.find((user) => user.role === "viewer")!;

  const run = await db.query<{ id: string }>(
    `INSERT INTO reconciliation_runs (
       organization_id, name, source_type, total_orders, processed_value,
       matched_value, unmatched_value, matched_count, exception_count,
       match_rate, source_files
     ) VALUES ($1,'Webhook run','upload',1,2499,0,2499,0,1,0,'{}')
     RETURNING id`,
    [organizationId],
  );
  const item = await db.query<{ id: string }>(
    `INSERT INTO reconciliation_items (
       organization_id, run_id, order_id, gateway_reference, payment_mode,
       order_amount, gateway_amount, settled_amount, expected_net, variance,
       reconciliation_status, severity, summary, evidence
     ) VALUES (
       $1,$2,'ORD-WEBHOOK','PAY-WEBHOOK','UPI',2499,2499,NULL,NULL,2499,
       'missing_settlement','high','Webhook test exception','[]'
     ) RETURNING id`,
    [organizationId, run.rows[0].id],
  );
  const paymentCase = await db.query<{ id: string }>(
    `INSERT INTO operations_cases (
       organization_id, item_id, run_id, priority, due_at
     ) VALUES ($1,$2,$3,'high',NOW() + INTERVAL '30 minutes')
     RETURNING id`,
    [organizationId, item.rows[0].id, run.rows[0].id],
  );
  const workflow = await db.query<{ id: string }>(
    `INSERT INTO payment_workflows (
       organization_id, workflow_type, external_reference, order_id,
       payment_reference, amount, reason, status, priority, due_at
     ) VALUES (
       $1,'refund','RF-WEBHOOK','ORD-WEBHOOK','PAY-WEBHOOK',2499,
       'Synthetic webhook integration test','processing','high',
       NOW() + INTERVAL '2 hours'
     ) RETURNING id`,
    [organizationId],
  );

  return {
    organizationId,
    organizationSlug,
    admin: {
      id: adminUser.id,
      name: adminUser.name,
      role: "admin",
      organizationId,
      organizationName: `Webhook ${label}`,
    },
    viewer: {
      id: viewerUser.id,
      name: viewerUser.name,
      role: "viewer",
      organizationId,
      organizationName: `Webhook ${label}`,
    },
    workflowId: workflow.rows[0].id,
    caseId: paymentCase.rows[0].id,
  };
}

afterEach(async () => {
  process.env.SYNTHETIC_WEBHOOK_SECRET = previousSecret;
  while (organizationsToDelete.length) {
    await db.query("DELETE FROM organizations WHERE id = $1", [
      organizationsToDelete.pop(),
    ]);
  }
});

describe("synthetic provider event ingestion", () => {
  it("verifies signatures, prevents replays, scopes evidence, and controls reads", async () => {
    process.env.SYNTHETIC_WEBHOOK_SECRET = "integration-webhook-secret";
    const tenant = await createFixture("primary");
    const otherTenant = await createFixture("other");
    const rawBody = JSON.stringify({
      eventType: "refund.created",
      occurredAt: "2026-06-19T10:30:00.000Z",
      payload: {
        refund: {
          id: "RF-WEBHOOK",
          payment_id: "PAY-WEBHOOK",
          order_id: "ORD-WEBHOOK",
          amount: 249900,
          status: "processed",
          private_note: "must-not-be-persisted",
        },
      },
    });
    const base = {
      providerId: "razorpay_demo",
      organizationSlug: tenant.organizationSlug,
      externalEventId: "evt-refund-webhook-1",
      rawBody,
    };
    const signature = syntheticWebhookSignature({
      ...base,
      secret: process.env.SYNTHETIC_WEBHOOK_SECRET,
    });

    await expect(
      receiveSyntheticProviderWebhook({
        ...base,
        signature: "0".repeat(64),
      }),
    ).rejects.toMatchObject({ status: 401 });

    const accepted = await receiveSyntheticProviderWebhook({
      ...base,
      signature,
    });
    expect(accepted.accepted).toBe(true);
    expect(accepted.matches).toEqual(
      expect.arrayContaining([
        { entityType: "operations_case", entityId: tenant.caseId },
        { entityType: "payment_workflow", entityId: tenant.workflowId },
      ]),
    );

    const duplicate = await receiveSyntheticProviderWebhook({
      ...base,
      signature,
    });
    expect(duplicate.accepted).toBe(false);
    expect(duplicate.providerEventId).toBe(accepted.providerEventId);

    const changedBody = rawBody.replace(
      '"status":"processed"',
      '"status":"pending"',
    );
    await expect(
      receiveSyntheticProviderWebhook({
        ...base,
        rawBody: changedBody,
        signature: syntheticWebhookSignature({
          ...base,
          rawBody: changedBody,
          secret: process.env.SYNTHETIC_WEBHOOK_SECRET,
        }),
      }),
    ).rejects.toMatchObject({ status: 409 });

    const events = await listPersistedProviderEvents(tenant.organizationId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      orderId: "ORD-WEBHOOK",
      paymentReference: "PAY-WEBHOOK",
      externalReference: "RF-WEBHOOK",
    });
    expect(
      await listPersistedProviderEvents(otherTenant.organizationId),
    ).toHaveLength(0);

    const workflows = await listPaymentWorkflows(tenant.organizationId);
    expect(
      workflows
        .find((workflow) => workflow.id === tenant.workflowId)
        ?.providerEvents?.some((event) => event.id === accepted.providerEventId),
    ).toBe(true);

    expect(
      (await getOperationalNotifications(tenant.viewer)).some(
        (notification) => notification.type === "sla_at_risk",
      ),
    ).toBe(false);
    const notifications = await getOperationalNotifications(tenant.admin);
    expect(
      notifications.filter((notification) => notification.type === "provider_event"),
    ).toHaveLength(2);
    expect(
      notifications.some(
        (notification) =>
          notification.type === "sla_at_risk" &&
          notification.entityId === tenant.caseId,
      ),
    ).toBe(true);
    expect(await getOperationalNotifications(otherTenant.admin)).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ entityId: tenant.caseId }),
      ]),
    );

    const notification = notifications.find(
      (item) => item.type === "provider_event",
    )!;
    await expect(
      readOperationalNotification(notification.id, tenant.viewer),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      readOperationalNotification(notification.id, otherTenant.admin),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      readOperationalNotification(notification.id, tenant.admin),
    ).resolves.toBe(notification.id);

    const delivery = await db.query<{
      payload_hash: string;
      raw_payload_column: string | null;
    }>(
      `SELECT delivery.payload_hash,
         (
           SELECT column_name
           FROM information_schema.columns
           WHERE table_name = 'provider_webhook_deliveries'
             AND column_name IN ('payload', 'raw_payload')
           LIMIT 1
         ) AS raw_payload_column
       FROM provider_webhook_deliveries delivery
       WHERE organization_id = $1`,
      [tenant.organizationId],
    );
    expect(delivery.rows[0].payload_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(delivery.rows[0].raw_payload_column).toBeNull();
  });
});
