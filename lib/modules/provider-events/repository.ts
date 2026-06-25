import type { PoolClient } from "pg";
import { query, transaction } from "@/lib/db";
import { recordAuditEvent } from "@/lib/modules/audit/repository";
import type {
  NormalizedProviderEvent,
  ProviderWebhookAttempt,
  ProviderWebhookObservability,
} from "@/lib/types";

type IngestionMatch = {
  entityType: "operations_case" | "payment_workflow";
  entityId: string;
};

function mapProviderEvent(row: {
  id: string;
  provider_id: NormalizedProviderEvent["providerId"];
  event_type: NormalizedProviderEvent["eventType"];
  title: string;
  order_id: string | null;
  payment_reference: string | null;
  external_reference: string | null;
  amount: string | null;
  status: string | null;
  occurred_at: Date;
  proves: string;
  does_not_prove: string;
}): NormalizedProviderEvent {
  return {
    id: row.id,
    providerId: row.provider_id,
    eventType: row.event_type,
    title: row.title,
    orderId: row.order_id,
    paymentReference: row.payment_reference,
    externalReference: row.external_reference,
    amount: row.amount === null ? null : Number(row.amount),
    status: row.status,
    occurredAt: row.occurred_at.toISOString(),
    proves: row.proves,
    doesNotProve: row.does_not_prove,
  };
}

export async function resolveOrganizationBySlug(slug: string) {
  const result = await query<{ id: string; name: string }>(
    "SELECT id, name FROM organizations WHERE slug = $1",
    [slug],
  );
  return result.rows[0] ?? null;
}

export async function listPersistedProviderEvents(
  organizationId: string,
  client?: PoolClient,
) {
  const execute = client ? client.query.bind(client) : query;
  const result = await execute<{
    id: string;
    provider_id: NormalizedProviderEvent["providerId"];
    event_type: NormalizedProviderEvent["eventType"];
    title: string;
    order_id: string | null;
    payment_reference: string | null;
    external_reference: string | null;
    amount: string | null;
    status: string | null;
    occurred_at: Date;
    proves: string;
    does_not_prove: string;
  }>(
    `SELECT id, provider_id, event_type, title, order_id, payment_reference,
       external_reference, amount, status, occurred_at, proves, does_not_prove
     FROM provider_events
     WHERE organization_id = $1
     ORDER BY occurred_at ASC`,
    [organizationId],
  );
  return result.rows.map(mapProviderEvent);
}

async function findMatches(
  client: PoolClient,
  organizationId: string,
  providerEvent: NormalizedProviderEvent,
): Promise<IngestionMatch[]> {
  const result = await client.query<{
    entity_type: IngestionMatch["entityType"];
    entity_id: string;
  }>(
    `SELECT 'operations_case'::text AS entity_type, c.id AS entity_id
     FROM operations_cases c
     JOIN reconciliation_items i
       ON i.id = c.item_id AND i.organization_id = c.organization_id
     WHERE c.organization_id = $1
       AND (
         ($2::text IS NOT NULL AND i.order_id = $2)
         OR ($3::text IS NOT NULL AND i.gateway_reference = $3)
       )
     UNION
     SELECT 'payment_workflow'::text AS entity_type, workflow.id AS entity_id
     FROM payment_workflows workflow
     WHERE workflow.organization_id = $1
       AND (
         ($2::text IS NOT NULL AND workflow.order_id = $2)
         OR ($3::text IS NOT NULL AND workflow.payment_reference = $3)
         OR ($4::text IS NOT NULL AND workflow.external_reference = $4)
       )`,
    [
      organizationId,
      providerEvent.orderId,
      providerEvent.paymentReference,
      providerEvent.externalReference,
    ],
  );
  return result.rows.map((row) => ({
    entityType: row.entity_type,
    entityId: row.entity_id,
  }));
}

export async function ingestProviderEvent(input: {
  organizationId: string;
  externalEventId: string;
  externalEventType: string;
  payloadHash: string;
  signatureVersion: string;
  signatureKeyId: string;
  providerEvent: NormalizedProviderEvent;
}) {
  return transaction(async (client) => {
    const delivery = await client.query<{ id: string }>(
      `INSERT INTO provider_webhook_deliveries (
         organization_id, provider_id, external_event_id, event_type,
       payload_hash, occurred_at
       , signature_version, signature_key_id, verified_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (organization_id, provider_id, external_event_id)
       DO NOTHING
       RETURNING id`,
      [
        input.organizationId,
        input.providerEvent.providerId,
        input.externalEventId,
        input.externalEventType,
        input.payloadHash,
        input.providerEvent.occurredAt,
        input.signatureVersion,
        input.signatureKeyId,
      ],
    );

    if (!delivery.rowCount) {
      const existing = await client.query<{
        id: string | null;
        payload_hash: string;
      }>(
        `SELECT event.id, delivery.payload_hash
         FROM provider_webhook_deliveries delivery
         LEFT JOIN provider_events event
           ON event.delivery_id = delivery.id
          AND event.organization_id = delivery.organization_id
         WHERE delivery.organization_id = $1
           AND delivery.provider_id = $2
           AND delivery.external_event_id = $3`,
        [
          input.organizationId,
          input.providerEvent.providerId,
          input.externalEventId,
        ],
      );
      return {
        accepted: false,
        providerEventId: existing.rows[0]?.id ?? null,
        samePayload:
          existing.rows[0]?.payload_hash === input.payloadHash,
        matches: [] as IngestionMatch[],
      };
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO provider_events (
         organization_id, delivery_id, provider_id, event_type, title,
         order_id, payment_reference, external_reference, amount, status,
         occurred_at, proves, does_not_prove
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [
        input.organizationId,
        delivery.rows[0].id,
        input.providerEvent.providerId,
        input.providerEvent.eventType,
        input.providerEvent.title,
        input.providerEvent.orderId,
        input.providerEvent.paymentReference,
        input.providerEvent.externalReference,
        input.providerEvent.amount,
        input.providerEvent.status,
        input.providerEvent.occurredAt,
        input.providerEvent.proves,
        input.providerEvent.doesNotProve,
      ],
    );
    const matches = await findMatches(
      client,
      input.organizationId,
      input.providerEvent,
    );

    for (const match of matches) {
      await client.query(
        `INSERT INTO operational_notifications (
           organization_id, notification_type, severity, title, message,
           entity_type, entity_id, dedupe_key
         ) VALUES ($1,'provider_event','info',$2,$3,$4,$5,$6)
         ON CONFLICT (organization_id, dedupe_key) DO NOTHING`,
        [
          input.organizationId,
          input.providerEvent.title,
          `${input.providerEvent.proves} Human verification remains required.`,
          match.entityType,
          match.entityId,
          `provider-event:${inserted.rows[0].id}:${match.entityType}:${match.entityId}`,
        ],
      );
    }

    await recordAuditEvent(
      {
        organizationId: input.organizationId,
        actorUserId: null,
        actorName: "Synthetic webhook boundary",
        action: "provider_event.ingested",
        entityType: "provider_event",
        entityId: inserted.rows[0].id,
        details: {
          providerId: input.providerEvent.providerId,
          externalEventId: input.externalEventId,
          matchedRecords: matches.length,
        },
      },
      client,
    );

    return {
      accepted: true,
      providerEventId: inserted.rows[0].id,
      samePayload: true,
      matches,
    };
  });
}

export async function recordProviderWebhookAttempt(input: {
  organizationId: string;
  providerId: NormalizedProviderEvent["providerId"];
  externalEventId: string;
  eventType?: string | null;
  payloadHash: string;
  signatureVersion: string;
  signatureKeyId?: string | null;
  keyState?: "active" | "previous" | null;
  outcome: ProviderWebhookAttempt["outcome"];
  httpStatus: number;
  failureCode?: string | null;
  matchedRecords?: number;
  providerEventId?: string | null;
  processingMs: number;
}) {
  await query(
    `INSERT INTO provider_webhook_attempts (
       organization_id, provider_id, external_event_id, event_type,
       payload_hash, signature_version, signature_key_id, key_state,
       outcome, http_status, failure_code, matched_records,
       provider_event_id, processing_ms
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      input.organizationId,
      input.providerId,
      input.externalEventId,
      input.eventType ?? null,
      input.payloadHash,
      input.signatureVersion,
      input.signatureKeyId ?? null,
      input.keyState ?? null,
      input.outcome,
      input.httpStatus,
      input.failureCode ?? null,
      input.matchedRecords ?? 0,
      input.providerEventId ?? null,
      input.processingMs,
    ],
  );
}

export async function getProviderWebhookObservability(
  organizationId: string,
): Promise<ProviderWebhookObservability> {
  const [summary, providers, recent] = await Promise.all([
    query<{
      total: number;
      accepted: number;
      duplicate: number;
      rejected: number;
      conflict: number;
      failed: number;
      previous_key_accepted: number;
      average_processing_ms: string | null;
    }>(
      `SELECT COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE outcome = 'accepted')::int AS accepted,
         COUNT(*) FILTER (WHERE outcome = 'duplicate')::int AS duplicate,
         COUNT(*) FILTER (WHERE outcome = 'rejected')::int AS rejected,
         COUNT(*) FILTER (WHERE outcome = 'conflict')::int AS conflict,
         COUNT(*) FILTER (WHERE outcome = 'failed')::int AS failed,
         COUNT(*) FILTER (
           WHERE outcome IN ('accepted','duplicate')
             AND key_state = 'previous'
         )::int AS previous_key_accepted,
         AVG(processing_ms) AS average_processing_ms
       FROM provider_webhook_attempts
       WHERE organization_id = $1`,
      [organizationId],
    ),
    query<{
      provider_id: NormalizedProviderEvent["providerId"];
      total: number;
      accepted: number;
      rejected: number;
      previous_key_accepted: number;
    }>(
      `SELECT provider_id, COUNT(*)::int AS total,
         COUNT(*) FILTER (
           WHERE outcome IN ('accepted','duplicate')
         )::int AS accepted,
         COUNT(*) FILTER (WHERE outcome = 'rejected')::int AS rejected,
         COUNT(*) FILTER (
           WHERE outcome IN ('accepted','duplicate')
             AND key_state = 'previous'
         )::int AS previous_key_accepted
       FROM provider_webhook_attempts
       WHERE organization_id = $1
       GROUP BY provider_id
       ORDER BY provider_id`,
      [organizationId],
    ),
    query<{
      id: string;
      provider_id: NormalizedProviderEvent["providerId"];
      external_event_id: string;
      event_type: string | null;
      signature_version: string;
      signature_key_id: string | null;
      key_state: "active" | "previous" | null;
      outcome: ProviderWebhookAttempt["outcome"];
      http_status: number;
      failure_code: string | null;
      matched_records: number;
      processing_ms: number;
      received_at: Date;
    }>(
      `SELECT id, provider_id, external_event_id, event_type,
         signature_version, signature_key_id, key_state, outcome,
         http_status, failure_code, matched_records, processing_ms,
         received_at
       FROM provider_webhook_attempts
       WHERE organization_id = $1
       ORDER BY received_at DESC LIMIT 100`,
      [organizationId],
    ),
  ]);
  const total = summary.rows[0];
  return {
    summary: {
      total: total.total,
      accepted: total.accepted,
      duplicate: total.duplicate,
      rejected: total.rejected,
      conflict: total.conflict,
      failed: total.failed,
      previousKeyAccepted: total.previous_key_accepted,
      averageProcessingMs:
        total.average_processing_ms === null
          ? null
          : Number(total.average_processing_ms),
    },
    byProvider: providers.rows.map((row) => ({
      providerId: row.provider_id,
      total: row.total,
      accepted: row.accepted,
      rejected: row.rejected,
      previousKeyAccepted: row.previous_key_accepted,
    })),
    recent: recent.rows.map((row) => ({
      id: row.id,
      providerId: row.provider_id,
      externalEventId: row.external_event_id,
      eventType: row.event_type,
      signatureVersion: row.signature_version,
      signatureKeyId: row.signature_key_id,
      keyState: row.key_state,
      outcome: row.outcome,
      httpStatus: row.http_status,
      failureCode: row.failure_code,
      matchedRecords: row.matched_records,
      processingMs: row.processing_ms,
      receivedAt: row.received_at.toISOString(),
    })),
  };
}
