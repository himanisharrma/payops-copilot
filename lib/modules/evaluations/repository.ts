import { query, transaction } from "@/lib/db";
import type {
  EvaluationCaseResult,
  EvaluationReviewScores,
  EvaluationRun,
  EvaluationRunDetail,
  EvaluationScenarioResult,
  InvestigationAnalysis,
} from "@/lib/types";

export async function saveEvaluationRun(
  evaluation: {
    datasetVersion: string;
    promptVersion: string;
    provider: EvaluationRun["provider"];
    model: string;
    summary: {
      total: number;
      passing: number;
      passRate: number;
      checksPassed: number;
      checksTotal: number;
      criticalSafetyFailures: number;
    };
    durationMs: number;
    usage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
    results: Array<{
      caseId: string;
      scenario: EvaluationScenarioResult["scenario"];
      summary: string;
      sourceEvidence: string[];
      analysis: InvestigationAnalysis;
      score: number;
      passed: boolean;
      checks: Record<string, boolean>;
      latencyMs?: number;
      usage?: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
    }>;
  },
  scenarios: EvaluationScenarioResult[],
  actor: {
    organizationId: string;
    id: string;
    name: string;
  },
) {
  return transaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO evaluation_runs (
        organization_id, dataset_version, prompt_version, provider, model,
        total_cases, passing_cases, pass_rate, checks_passed, checks_total,
        critical_safety_failures, duration_ms, input_tokens, output_tokens,
        total_tokens, created_by, created_by_name
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING id`,
      [
        actor.organizationId,
        evaluation.datasetVersion,
        evaluation.promptVersion,
        evaluation.provider,
        evaluation.model,
        evaluation.summary.total,
        evaluation.summary.passing,
        evaluation.summary.passRate,
        evaluation.summary.checksPassed,
        evaluation.summary.checksTotal,
        evaluation.summary.criticalSafetyFailures,
        evaluation.durationMs,
        evaluation.usage.inputTokens,
        evaluation.usage.outputTokens,
        evaluation.usage.totalTokens,
        actor.id,
        actor.name,
      ],
    );

    for (const scenario of scenarios) {
      await client.query(
        `INSERT INTO evaluation_scenario_results (
          evaluation_run_id, scenario, total_cases, passing_cases,
          average_score, critical_safety_failures
        ) VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          inserted.rows[0].id,
          scenario.scenario,
          scenario.total,
          scenario.passing,
          scenario.averageScore,
          scenario.criticalSafetyFailures,
        ],
      );
    }

    for (const result of evaluation.results) {
      await client.query(
        `INSERT INTO evaluation_case_results (
          evaluation_run_id, case_key, scenario, case_summary, source_evidence,
          generated_analysis, automated_score, automated_passed, automated_checks,
          latency_ms, input_tokens, output_tokens, total_tokens
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          inserted.rows[0].id,
          result.caseId,
          result.scenario,
          result.summary,
          JSON.stringify(result.sourceEvidence),
          JSON.stringify(result.analysis),
          result.score,
          result.passed,
          JSON.stringify(result.checks),
          result.latencyMs ?? null,
          result.usage?.inputTokens ?? null,
          result.usage?.outputTokens ?? null,
          result.usage?.totalTokens ?? null,
        ],
      );
    }
    return inserted.rows[0].id;
  });
}

export async function getEvaluationRun(
  id: string,
  organizationId: string,
): Promise<EvaluationRunDetail | null> {
  const runs = await listEvaluationRuns(organizationId);
  const run = runs.find((item) => item.id === id);
  if (!run) return null;

  const result = await query<{
    id: string;
    case_key: string;
    scenario: EvaluationCaseResult["scenario"];
    case_summary: string;
    source_evidence: string[];
    generated_analysis: InvestigationAnalysis;
    automated_score: number;
    automated_passed: boolean;
    automated_checks: Record<string, boolean>;
    latency_ms: number | null;
    input_tokens: number | null;
    output_tokens: number | null;
    total_tokens: number | null;
    grounding_score: number | null;
    safety_score: number | null;
    uncertainty_score: number | null;
    action_score: number | null;
    provider_message_score: number | null;
    completeness_score: number | null;
    reviewer_notes: string;
    reviewed_by_name: string | null;
    reviewed_at: Date | null;
  }>(
    `SELECT ecr.*
     FROM evaluation_case_results ecr
     JOIN evaluation_runs er ON er.id = ecr.evaluation_run_id
     WHERE ecr.evaluation_run_id = $1 AND er.organization_id = $2
     ORDER BY ecr.scenario, ecr.case_key`,
    [id, organizationId],
  );

  return {
    ...run,
    cases: result.rows.map((row) => ({
      id: row.id,
      caseKey: row.case_key,
      scenario: row.scenario,
      summary: row.case_summary,
      sourceEvidence: row.source_evidence,
      analysis: row.generated_analysis,
      automatedScore: row.automated_score,
      automatedPassed: row.automated_passed,
      automatedChecks: row.automated_checks,
      latencyMs: row.latency_ms,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      totalTokens: row.total_tokens,
      reviewScores: {
        grounding: row.grounding_score,
        safety: row.safety_score,
        uncertainty: row.uncertainty_score,
        action: row.action_score,
        providerMessage: row.provider_message_score,
        completeness: row.completeness_score,
      },
      reviewerNotes: row.reviewer_notes,
      reviewedByName: row.reviewed_by_name,
      reviewedAt: row.reviewed_at?.toISOString() ?? null,
    })),
  };
}

export async function reviewEvaluationCase(
  id: string,
  evaluationRunId: string,
  organizationId: string,
  review: {
    scores: EvaluationReviewScores;
    notes: string;
    reviewerId: string;
    reviewerName: string;
  },
) {
  const result = await query<{ evaluation_run_id: string }>(
    `UPDATE evaluation_case_results ecr SET
       grounding_score = $4,
       safety_score = $5,
       uncertainty_score = $6,
       action_score = $7,
       provider_message_score = $8,
       completeness_score = $9,
       reviewer_notes = $10,
       reviewed_by = $11,
       reviewed_by_name = $12,
       reviewed_at = NOW()
     FROM evaluation_runs er
     WHERE ecr.id = $1
       AND ecr.evaluation_run_id = $2
       AND er.id = ecr.evaluation_run_id
       AND er.organization_id = $3
     RETURNING ecr.evaluation_run_id`,
    [
      id,
      evaluationRunId,
      organizationId,
      review.scores.grounding,
      review.scores.safety,
      review.scores.uncertainty,
      review.scores.action,
      review.scores.providerMessage,
      review.scores.completeness,
      review.notes,
      review.reviewerId,
      review.reviewerName,
    ],
  );
  return result.rows[0]?.evaluation_run_id ?? null;
}

export async function listEvaluationRuns(
  organizationId: string,
): Promise<EvaluationRun[]> {
  const result = await query<{
    id: string;
    dataset_version: string;
    prompt_version: string;
    provider: EvaluationRun["provider"];
    model: string;
    total_cases: number;
    passing_cases: number;
    pass_rate: number;
    checks_passed: number;
    checks_total: number;
    critical_safety_failures: number;
    duration_ms: number | null;
    input_tokens: number | null;
    output_tokens: number | null;
    total_tokens: number | null;
    created_by_name: string;
    created_at: Date;
    scenarios: EvaluationScenarioResult[];
  }>(
    `SELECT er.*,
       COALESCE(
         jsonb_agg(
           jsonb_build_object(
             'scenario', esr.scenario,
             'total', esr.total_cases,
             'passing', esr.passing_cases,
             'averageScore', esr.average_score,
             'criticalSafetyFailures', esr.critical_safety_failures
           ) ORDER BY esr.scenario
         ) FILTER (WHERE esr.id IS NOT NULL),
         '[]'::jsonb
       ) AS scenarios
     FROM evaluation_runs er
     LEFT JOIN evaluation_scenario_results esr
       ON esr.evaluation_run_id = er.id
     WHERE er.organization_id = $1
     GROUP BY er.id
     ORDER BY er.created_at DESC
     LIMIT 20`,
    [organizationId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    datasetVersion: row.dataset_version,
    promptVersion: row.prompt_version,
    provider: row.provider,
    model: row.model,
    totalCases: row.total_cases,
    passingCases: row.passing_cases,
    passRate: row.pass_rate,
    checksPassed: row.checks_passed,
    checksTotal: row.checks_total,
    criticalSafetyFailures: row.critical_safety_failures,
    durationMs: row.duration_ms,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    totalTokens: row.total_tokens,
    createdByName: row.created_by_name,
    createdAt: row.created_at.toISOString(),
    scenarios: row.scenarios.map((scenario) => ({
      ...scenario,
      averageScore: Number(scenario.averageScore),
    })),
  }));
}
