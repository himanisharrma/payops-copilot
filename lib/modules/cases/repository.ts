import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import {
  mergeProviderEvents,
  providerEventsForEntity,
} from "@/lib/provider-webhooks";
import { listPersistedProviderEvents } from "@/lib/modules/provider-events/repository";
import { getSlaStatus } from "@/lib/sla";
import type {
  AIInvestigation,
  CaseStatus,
  OperationsCase,
  SourceEvidence,
} from "@/lib/types";

export async function listCases(
  organizationId: string,
  client?: PoolClient,
): Promise<OperationsCase[]> {
  const execute = client ? client.query.bind(client) : query;
  const result = await execute<{
    id: string;
    run_id: string;
    run_name: string;
    order_id: string;
    gateway_reference: string;
    payment_mode: string;
    order_amount: string;
    variance: string;
    reconciliation_status: OperationsCase["reconciliationStatus"];
    summary: string;
    evidence: string[];
    source_evidence: SourceEvidence[] | null;
    priority: OperationsCase["priority"];
    case_status: CaseStatus;
    owner: string | null;
    notes: string;
    due_at: Date;
    resolved_at: Date | null;
    resolution_reason: string | null;
    resolution_evidence_confirmed: boolean;
    resolved_by_name: string | null;
    created_at: Date;
    updated_at: Date;
    investigation_id: string | null;
    investigation_provider: AIInvestigation["provider"] | null;
    investigation_model: string | null;
    investigation_prompt_version: string | null;
    likely_cause: string | null;
    confidence: AIInvestigation["confidence"] | null;
    supporting_evidence: string[] | null;
    recommended_actions: string[] | null;
    provider_message: string | null;
    limitations: string[] | null;
    approval_status: AIInvestigation["approvalStatus"] | null;
    feedback_rating: AIInvestigation["feedbackRating"];
    feedback_notes: string | null;
    investigation_created_at: Date | null;
    investigation_updated_at: Date | null;
  }>(
    `SELECT c.*, r.name AS run_name, i.order_id, i.gateway_reference,
       i.payment_mode, i.order_amount, i.variance, i.reconciliation_status,
       i.summary, i.evidence, evidence.source_evidence,
       ai.id AS investigation_id, ai.provider AS investigation_provider,
       ai.model AS investigation_model,
       ai.prompt_version AS investigation_prompt_version,
       ai.likely_cause, ai.confidence,
       ai.supporting_evidence, ai.recommended_actions, ai.provider_message,
       ai.limitations, ai.approval_status, ai.feedback_rating,
       ai.feedback_notes, ai.created_at AS investigation_created_at,
       ai.updated_at AS investigation_updated_at
     FROM operations_cases c
     JOIN reconciliation_runs r
       ON r.id = c.run_id AND r.organization_id = c.organization_id
     JOIN reconciliation_items i
       ON i.id = c.item_id
      AND i.run_id = c.run_id
      AND i.organization_id = c.organization_id
     LEFT JOIN LATERAL (
       SELECT JSONB_AGG(
         JSONB_BUILD_OBJECT(
           'sourceType', source_type,
           'rowNumber', row_number,
           'normalizedValues', normalized_values,
           'sourceValues', source_values,
           'integrityHash', integrity_hash
         )
         ORDER BY
           CASE source_type
             WHEN 'orders' THEN 1
             WHEN 'gateway' THEN 2
             ELSE 3
           END,
           row_number
       ) AS source_evidence
       FROM reconciliation_source_evidence
       WHERE item_id = i.id AND organization_id = c.organization_id
     ) evidence ON TRUE
     LEFT JOIN LATERAL (
       SELECT * FROM ai_investigations
       WHERE case_id = c.id
       ORDER BY created_at DESC
       LIMIT 1
     ) ai ON TRUE
     WHERE c.organization_id = $1
     ORDER BY
       CASE c.case_status WHEN 'open' THEN 1 WHEN 'investigating' THEN 2 ELSE 3 END,
       c.due_at ASC,
       c.created_at DESC`,
    [organizationId],
  );
  const persistedProviderEvents = await listPersistedProviderEvents(
    organizationId,
    client,
  );

  return result.rows.map((row) => {
    const createdAt = row.created_at.toISOString();
    const dueAt = row.due_at.toISOString();
    const resolvedAt = row.resolved_at?.toISOString() ?? null;
    return {
      id: row.id,
      runId: row.run_id,
      runName: row.run_name,
      orderId: row.order_id,
      gatewayReference: row.gateway_reference,
      paymentMode: row.payment_mode,
      orderAmount: Number(row.order_amount),
      variance: Number(row.variance),
      reconciliationStatus: row.reconciliation_status,
      summary: row.summary,
      evidence: row.evidence,
      sourceEvidence: row.source_evidence ?? [],
      priority: row.priority,
      status: row.case_status,
      owner: row.owner,
      notes: row.notes,
      dueAt,
      resolvedAt,
      resolutionReason: row.resolution_reason,
      resolutionEvidenceConfirmed: row.resolution_evidence_confirmed,
      resolvedByName: row.resolved_by_name,
      slaStatus: getSlaStatus({
        createdAt,
        dueAt,
        resolvedAt,
        status: row.case_status,
        priority: row.priority,
      }),
      createdAt,
      updatedAt: row.updated_at.toISOString(),
      latestInvestigation: row.investigation_id
        ? {
            id: row.investigation_id,
            caseId: row.id,
            provider: row.investigation_provider!,
            model: row.investigation_model!,
            promptVersion: row.investigation_prompt_version!,
            likelyCause: row.likely_cause!,
            confidence: row.confidence!,
            supportingEvidence: row.supporting_evidence ?? [],
            recommendedActions: row.recommended_actions ?? [],
            providerMessage: row.provider_message!,
            limitations: row.limitations ?? [],
            approvalStatus: row.approval_status!,
            feedbackRating: row.feedback_rating,
            feedbackNotes: row.feedback_notes ?? "",
            createdAt: row.investigation_created_at!.toISOString(),
            updatedAt: row.investigation_updated_at!.toISOString(),
          }
        : null,
      providerEvents: mergeProviderEvents(
        providerEventsForEntity({
          orderId: row.order_id,
          paymentReference: row.gateway_reference,
        }),
        persistedProviderEvents.filter(
          (providerEvent) =>
            providerEvent.orderId === row.order_id ||
            providerEvent.paymentReference === row.gateway_reference,
        ),
      ),
    };
  });
}

export async function getCase(
  id: string,
  organizationId: string,
  client?: PoolClient,
) {
  return (await listCases(organizationId, client)).find(
    (item) => item.id === id,
  ) ?? null;
}

export async function updateCase(
  client: PoolClient,
  id: string,
  organizationId: string,
  patch: {
    status?: CaseStatus;
    priority?: OperationsCase["priority"];
    owner?: string | null;
    notes?: string;
    resolutionReason?: string;
    resolutionEvidenceConfirmed?: boolean;
    resolvedByUserId?: string;
    resolvedByName?: string;
  },
) {
  const existing = await client.query<{ case_status: CaseStatus }>(
    "SELECT case_status FROM operations_cases WHERE id = $1 AND organization_id = $2",
    [id, organizationId],
  );
  if (!existing.rowCount) return null;

  await client.query(
    `UPDATE operations_cases SET
       case_status = COALESCE($2, case_status),
       priority = COALESCE($3, priority),
       due_at = CASE
         WHEN $3 = 'high' THEN created_at + INTERVAL '4 hours'
         WHEN $3 = 'medium' THEN created_at + INTERVAL '24 hours'
         WHEN $3 = 'low' THEN created_at + INTERVAL '72 hours'
         ELSE due_at
       END,
       owner = CASE WHEN $4::boolean THEN $5 ELSE owner END,
       notes = COALESCE($6, notes),
       resolved_at = CASE
         WHEN $2 = 'resolved' THEN COALESCE(resolved_at, NOW())
         WHEN $2 IS NOT NULL AND $2 <> 'resolved' THEN NULL
         ELSE resolved_at
       END,
       resolution_reason = CASE
         WHEN $2 = 'resolved' THEN $7
         WHEN $2 IS NOT NULL AND $2 <> 'resolved' THEN NULL
         ELSE resolution_reason
       END,
       resolution_evidence_confirmed = CASE
         WHEN $2 = 'resolved' THEN $8
         WHEN $2 IS NOT NULL AND $2 <> 'resolved' THEN FALSE
         ELSE resolution_evidence_confirmed
       END,
       resolved_by_user_id = CASE
         WHEN $2 = 'resolved' THEN $9
         WHEN $2 IS NOT NULL AND $2 <> 'resolved' THEN NULL
         ELSE resolved_by_user_id
       END,
       resolved_by_name = CASE
         WHEN $2 = 'resolved' THEN $10
         WHEN $2 IS NOT NULL AND $2 <> 'resolved' THEN NULL
         ELSE resolved_by_name
       END,
       updated_at = NOW()
     WHERE id = $1 AND organization_id = $11`,
    [
      id,
      patch.status ?? null,
      patch.priority ?? null,
      Object.prototype.hasOwnProperty.call(patch, "owner"),
      patch.owner ?? null,
      patch.notes ?? null,
      patch.resolutionReason ?? null,
      patch.resolutionEvidenceConfirmed ?? false,
      patch.resolvedByUserId ?? null,
      patch.resolvedByName ?? null,
      organizationId,
    ],
  );
  return getCase(id, organizationId, client);
}
