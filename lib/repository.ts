import type { PoolClient } from "pg";
import { query, transaction } from "@/lib/db";
import type {
  AIInvestigation,
  CaseStatus,
  InvestigationAnalysis,
  InvestigationApproval,
  OperationsCase,
  ReconciliationResult,
  RunSummary,
} from "@/lib/types";

export async function saveReconciliationRun(
  result: ReconciliationResult,
  metadata: {
    name: string;
    sourceType: string;
    sourceFiles: Record<string, string>;
  },
) {
  return transaction(async (client) => {
    const run = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO reconciliation_runs (
        name, source_type, total_orders, processed_value, matched_value,
        unmatched_value, matched_count, exception_count, match_rate, source_files
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id, created_at`,
      [
        metadata.name,
        metadata.sourceType,
        result.summary.totalOrders,
        result.summary.processedValue,
        result.summary.matchedValue,
        result.summary.unmatchedValue,
        result.summary.matchedCount,
        result.summary.exceptionCount,
        result.summary.matchRate,
        metadata.sourceFiles,
      ],
    );
    const runId = run.rows[0].id;

    for (const item of result.items) {
      const storedItem = await insertItem(client, runId, item);
      if (!["matched", "pending"].includes(item.status)) {
        await client.query(
          `INSERT INTO operations_cases (item_id, run_id, priority)
           VALUES ($1, $2, $3)`,
          [storedItem.id, runId, item.severity],
        );
      }
    }

    return {
      ...result,
      id: runId,
      generatedAt: run.rows[0].created_at.toISOString(),
    };
  });
}

async function insertItem(
  client: PoolClient,
  runId: string,
  item: ReconciliationResult["items"][number],
) {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO reconciliation_items (
      run_id, order_id, gateway_reference, payment_mode, order_amount,
      gateway_amount, settled_amount, expected_net, variance,
      reconciliation_status, severity, summary, evidence
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    RETURNING id`,
    [
      runId,
      item.orderId,
      item.gatewayReference,
      item.paymentMode,
      item.orderAmount,
      item.gatewayAmount,
      item.settledAmount,
      item.expectedNet,
      item.variance,
      item.status,
      item.severity,
      item.summary,
      JSON.stringify(item.evidence),
    ],
  );
  return inserted.rows[0];
}

export async function listRuns(): Promise<RunSummary[]> {
  const result = await query<{
    id: string;
    name: string;
    source_type: string;
    status: string;
    total_orders: number;
    processed_value: string;
    matched_value: string;
    unmatched_value: string;
    matched_count: number;
    exception_count: number;
    match_rate: string;
    created_at: Date;
  }>(
    `SELECT * FROM reconciliation_runs
     ORDER BY created_at DESC LIMIT 50`,
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    sourceType: row.source_type,
    status: row.status,
    totalOrders: row.total_orders,
    processedValue: Number(row.processed_value),
    matchedValue: Number(row.matched_value),
    unmatchedValue: Number(row.unmatched_value),
    matchedCount: row.matched_count,
    exceptionCount: row.exception_count,
    matchRate: Number(row.match_rate),
    createdAt: row.created_at.toISOString(),
  }));
}

export async function listCases(): Promise<OperationsCase[]> {
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
    created_at: Date;
    updated_at: Date;
    investigation_id: string | null;
    investigation_provider: AIInvestigation["provider"] | null;
    investigation_model: string | null;
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
       ai.model AS investigation_model, ai.likely_cause, ai.confidence,
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
     ORDER BY
       CASE c.case_status WHEN 'open' THEN 1 WHEN 'investigating' THEN 2 ELSE 3 END,
       CASE c.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       c.created_at DESC`,
  );

  return result.rows.map((row) => ({
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
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    latestInvestigation: row.investigation_id
      ? {
          id: row.investigation_id,
          caseId: row.id,
          provider: row.investigation_provider!,
          model: row.investigation_model!,
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
  }));
}

export async function getCase(id: string) {
  return (await listCases()).find((item) => item.id === id) ?? null;
}

export async function saveInvestigation(
  caseId: string,
  analysis: InvestigationAnalysis,
  metadata: { provider: AIInvestigation["provider"]; model: string },
) {
  const result = await query<{ id: string }>(
    `INSERT INTO ai_investigations (
      case_id, provider, model, likely_cause, confidence,
      supporting_evidence, recommended_actions, provider_message, limitations
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING id`,
    [
      caseId,
      metadata.provider,
      metadata.model,
      analysis.likelyCause,
      analysis.confidence,
      JSON.stringify(analysis.supportingEvidence),
      JSON.stringify(analysis.recommendedActions),
      analysis.providerMessage,
      JSON.stringify(analysis.limitations),
    ],
  );
  return result.rows[0].id;
}

export async function updateInvestigation(
  id: string,
  patch: {
    approvalStatus?: InvestigationApproval;
    feedbackRating?: AIInvestigation["feedbackRating"];
    feedbackNotes?: string;
  },
) {
  await query(
    `UPDATE ai_investigations SET
      approval_status = COALESCE($2, approval_status),
      feedback_rating = COALESCE($3, feedback_rating),
      feedback_notes = COALESCE($4, feedback_notes),
      approved_at = CASE
        WHEN $2 = 'approved' THEN NOW()
        WHEN $2 IS NOT NULL THEN NULL
        ELSE approved_at
      END,
      updated_at = NOW()
     WHERE id = $1`,
    [
      id,
      patch.approvalStatus ?? null,
      patch.feedbackRating ?? null,
      patch.feedbackNotes ?? null,
    ],
  );
  const result = await query<{ case_id: string }>(
    "SELECT case_id FROM ai_investigations WHERE id = $1",
    [id],
  );
  return result.rowCount ? getCase(result.rows[0].case_id) : null;
}

export async function updateCase(
  id: string,
  patch: {
    status?: CaseStatus;
    priority?: OperationsCase["priority"];
    owner?: string | null;
    notes?: string;
  },
) {
  const existing = await query<{ case_status: CaseStatus }>(
    "SELECT case_status FROM operations_cases WHERE id = $1",
    [id],
  );
  if (!existing.rowCount) return null;

  await query(
    `UPDATE operations_cases SET
       case_status = COALESCE($2, case_status),
       priority = COALESCE($3, priority),
       owner = CASE WHEN $4::boolean THEN $5 ELSE owner END,
       notes = COALESCE($6, notes),
       resolved_at = CASE
         WHEN $2 = 'resolved' THEN NOW()
         WHEN $2 IS NOT NULL AND $2 <> 'resolved' THEN NULL
         ELSE resolved_at
       END,
       updated_at = NOW()
     WHERE id = $1`,
    [
      id,
      patch.status ?? null,
      patch.priority ?? null,
      Object.prototype.hasOwnProperty.call(patch, "owner"),
      patch.owner ?? null,
      patch.notes ?? null,
    ],
  );
  return (await listCases()).find((item) => item.id === id) ?? null;
}

export async function databaseHealth() {
  const result = await query<{ now: Date }>("SELECT NOW() AS now");
  return result.rows[0].now.toISOString();
}
