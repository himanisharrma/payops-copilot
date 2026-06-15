import { query } from "@/lib/db";
import { getSlaStatus } from "@/lib/sla";
import type {
  AIInvestigation,
  CaseStatus,
  OperationsCase,
} from "@/lib/types";

export async function listCases(
  organizationId: string,
): Promise<OperationsCase[]> {
  const result = await query<{
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
    priority: OperationsCase["priority"];
    case_status: CaseStatus;
    owner: string | null;
    notes: string;
    due_at: Date;
    resolved_at: Date | null;
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
       i.summary, i.evidence,
       ai.id AS investigation_id, ai.provider AS investigation_provider,
       ai.model AS investigation_model,
       ai.prompt_version AS investigation_prompt_version,
       ai.likely_cause, ai.confidence,
       ai.supporting_evidence, ai.recommended_actions, ai.provider_message,
       ai.limitations, ai.approval_status, ai.feedback_rating,
       ai.feedback_notes, ai.created_at AS investigation_created_at,
       ai.updated_at AS investigation_updated_at
     FROM operations_cases c
     JOIN reconciliation_runs r ON r.id = c.run_id
     JOIN reconciliation_items i ON i.id = c.item_id
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
      priority: row.priority,
      status: row.case_status,
      owner: row.owner,
      notes: row.notes,
      dueAt,
      resolvedAt,
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
    };
  });
}

export async function getCase(id: string, organizationId: string) {
  return (await listCases(organizationId)).find((item) => item.id === id) ?? null;
}

export async function updateCase(
  id: string,
  organizationId: string,
  patch: {
    status?: CaseStatus;
    priority?: OperationsCase["priority"];
    owner?: string | null;
    notes?: string;
  },
) {
  const existing = await query<{ case_status: CaseStatus }>(
    "SELECT case_status FROM operations_cases WHERE id = $1 AND organization_id = $2",
    [id, organizationId],
  );
  if (!existing.rowCount) return null;

  await query(
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
         WHEN $2 = 'resolved' THEN NOW()
         WHEN $2 IS NOT NULL AND $2 <> 'resolved' THEN NULL
         ELSE resolved_at
       END,
       updated_at = NOW()
     WHERE id = $1 AND organization_id = $7`,
    [
      id,
      patch.status ?? null,
      patch.priority ?? null,
      Object.prototype.hasOwnProperty.call(patch, "owner"),
      patch.owner ?? null,
      patch.notes ?? null,
      organizationId,
    ],
  );
  return getCase(id, organizationId);
}
