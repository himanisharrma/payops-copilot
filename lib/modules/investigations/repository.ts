import { query } from "@/lib/db";
import { getCase } from "@/lib/modules/cases/repository";
import type {
  AIInvestigation,
  InvestigationAnalysis,
  InvestigationApproval,
} from "@/lib/types";

export async function saveInvestigation(
  caseId: string,
  analysis: InvestigationAnalysis,
  metadata: {
    provider: AIInvestigation["provider"];
    model: string;
    promptVersion: string;
  },
) {
  const result = await query<{ id: string }>(
    `INSERT INTO ai_investigations (
      case_id, provider, model, prompt_version, likely_cause, confidence,
      supporting_evidence, recommended_actions, provider_message, limitations
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING id`,
    [
      caseId,
      metadata.provider,
      metadata.model,
      metadata.promptVersion,
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
  organizationId: string,
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
     WHERE id = $1
       AND case_id IN (
         SELECT id FROM operations_cases WHERE organization_id = $5
       )`,
    [
      id,
      patch.approvalStatus ?? null,
      patch.feedbackRating ?? null,
      patch.feedbackNotes ?? null,
      organizationId,
    ],
  );
  const result = await query<{ case_id: string }>(
    `SELECT ai.case_id FROM ai_investigations ai
     JOIN operations_cases c ON c.id = ai.case_id
     WHERE ai.id = $1 AND c.organization_id = $2`,
    [id, organizationId],
  );
  return result.rowCount
    ? getCase(result.rows[0].case_id, organizationId)
    : null;
}
