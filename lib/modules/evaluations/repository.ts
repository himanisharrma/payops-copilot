import { query, transaction } from "@/lib/db";
import type {
  EvaluationCaseAdjudication,
  EvaluationCaseReview,
  EvaluationCaseResult,
  EvaluationReviewScores,
  EvaluationReviewStatus,
  EvaluationRun,
  EvaluationRunDetail,
  EvaluationScenarioResult,
  InvestigationAnalysis,
} from "@/lib/types";

function scoreTotal(scores: EvaluationReviewScores) {
  return Object.values(scores).reduce<number>(
    (total, score) => total + (score ?? 0),
    0,
  );
}

function reviewsAgree(reviews: EvaluationCaseReview[]) {
  if (reviews.length < 2) return false;
  const [left, right] = reviews;
  return (
    left.scores.grounding === right.scores.grounding &&
    left.scores.safety === right.scores.safety &&
    left.scores.uncertainty === right.scores.uncertainty &&
    left.scores.action === right.scores.action &&
    left.scores.providerMessage === right.scores.providerMessage &&
    left.scores.completeness === right.scores.completeness
  );
}

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

  const assignmentsResult = await query<{
    reviewer_slot: 1 | 2;
    reviewer_user_id: string;
    reviewer_name: string;
    assigned_at: Date;
  }>(
    `SELECT reviewer_slot, reviewer_user_id, reviewer_name, assigned_at
     FROM evaluation_review_assignments
     WHERE evaluation_run_id = $1 AND organization_id = $2
     ORDER BY reviewer_slot`,
    [id, organizationId],
  );

  const reviewsResult = await query<{
    id: string;
    evaluation_case_result_id: string;
    reviewer_user_id: string;
    reviewer_name: string;
    reviewer_slot: 1 | 2;
    grounding_score: number;
    safety_score: number;
    uncertainty_score: number;
    action_score: number;
    provider_message_score: number;
    completeness_score: number;
    reviewer_notes: string;
    reviewed_at: Date;
  }>(
    `SELECT review.*
     FROM evaluation_case_reviews review
     JOIN evaluation_runs run ON run.id = review.evaluation_run_id
     WHERE review.evaluation_run_id = $1
       AND review.organization_id = $2
       AND run.organization_id = review.organization_id
     ORDER BY review.reviewer_slot`,
    [id, organizationId],
  );

  const adjudicationsResult = await query<{
    evaluation_case_result_id: string;
    grounding_score: number;
    safety_score: number;
    uncertainty_score: number;
    action_score: number;
    provider_message_score: number;
    completeness_score: number;
    adjudicator_notes: string;
    adjudicated_by_name: string;
    adjudicated_at: Date;
  }>(
    `SELECT adjudication.*
     FROM evaluation_case_adjudications adjudication
     JOIN evaluation_runs run ON run.id = adjudication.evaluation_run_id
     WHERE adjudication.evaluation_run_id = $1
       AND adjudication.organization_id = $2
       AND run.organization_id = adjudication.organization_id`,
    [id, organizationId],
  );

  const reviewsByCase = new Map<string, EvaluationCaseReview[]>();
  for (const review of reviewsResult.rows) {
    const scores = {
      grounding: review.grounding_score,
      safety: review.safety_score,
      uncertainty: review.uncertainty_score,
      action: review.action_score,
      providerMessage: review.provider_message_score,
      completeness: review.completeness_score,
    };
    const mapped = {
      id: review.id,
      reviewerUserId: review.reviewer_user_id,
      reviewerName: review.reviewer_name,
      reviewerSlot: review.reviewer_slot,
      scores,
      notes: review.reviewer_notes,
      totalScore: scoreTotal(scores),
      reviewedAt: review.reviewed_at.toISOString(),
    };
    reviewsByCase.set(review.evaluation_case_result_id, [
      ...(reviewsByCase.get(review.evaluation_case_result_id) ?? []),
      mapped,
    ]);
  }

  const adjudicationByCase = new Map<string, EvaluationCaseAdjudication>();
  for (const adjudication of adjudicationsResult.rows) {
    const scores = {
      grounding: adjudication.grounding_score,
      safety: adjudication.safety_score,
      uncertainty: adjudication.uncertainty_score,
      action: adjudication.action_score,
      providerMessage: adjudication.provider_message_score,
      completeness: adjudication.completeness_score,
    };
    adjudicationByCase.set(adjudication.evaluation_case_result_id, {
      scores,
      notes: adjudication.adjudicator_notes,
      totalScore: scoreTotal(scores),
      adjudicatedByName: adjudication.adjudicated_by_name,
      adjudicatedAt: adjudication.adjudicated_at.toISOString(),
    });
  }

  const cases = result.rows.map((row) => {
    const reviews = reviewsByCase.get(row.id) ?? [];
    const adjudication = adjudicationByCase.get(row.id) ?? null;
    const reviewStatus: EvaluationReviewStatus = adjudication
      ? "adjudicated"
      : reviews.length < 1
        ? "unreviewed"
        : reviews.length < 2
          ? "single_review"
          : reviewsAgree(reviews)
            ? "agreed"
            : "disputed";
    const averageHumanScore = adjudication
      ? adjudication.totalScore
      : reviews.length
        ? Number(
            (
              reviews.reduce((total, review) => total + review.totalScore, 0) /
              reviews.length
            ).toFixed(2),
          )
        : null;
    return {
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
      reviews,
      adjudication,
      reviewStatus,
      averageHumanScore,
    };
  });
  const reviewedCases = cases.filter(
    (item) => item.reviews.length > 0,
  ).length;
  const doubleReviewedCases = cases.filter(
    (item) => item.reviews.length === 2,
  ).length;
  const disputedCases = cases.filter(
    (item) => item.reviewStatus === "disputed",
  ).length;
  const adjudicatedCases = cases.filter(
    (item) => item.reviewStatus === "adjudicated",
  ).length;
  const scoredCases = cases.filter(
    (item) => item.averageHumanScore !== null,
  );

  return {
    ...run,
    cases,
    reviewerAssignments: assignmentsResult.rows.map((assignment) => ({
      slot: assignment.reviewer_slot,
      reviewerUserId: assignment.reviewer_user_id,
      reviewerName: assignment.reviewer_name,
      assignedAt: assignment.assigned_at.toISOString(),
    })),
    humanSummary: {
      assignedReviewers: assignmentsResult.rowCount ?? 0,
      reviewedCases,
      doubleReviewedCases,
      disputedCases,
      adjudicatedCases,
      averageScore: scoredCases.length
        ? Number(
            (
              scoredCases.reduce(
                (total, item) => total + item.averageHumanScore!,
                0,
              ) / scoredCases.length
            ).toFixed(2),
          )
        : null,
    },
  };
}

export async function claimEvaluationReviewer(
  evaluationRunId: string,
  organizationId: string,
  actor: { id: string; name: string },
) {
  return transaction(async (client) => {
    const run = await client.query(
      `SELECT id FROM evaluation_runs
       WHERE id = $1 AND organization_id = $2
       FOR UPDATE`,
      [evaluationRunId, organizationId],
    );
    if (!run.rowCount) return { status: "not_found" as const };

    const existing = await client.query<{
      reviewer_slot: 1 | 2;
    }>(
      `SELECT reviewer_slot FROM evaluation_review_assignments
       WHERE evaluation_run_id = $1
         AND organization_id = $2
         AND reviewer_user_id = $3`,
      [evaluationRunId, organizationId, actor.id],
    );
    if (existing.rowCount) {
      return {
        status: "assigned" as const,
        slot: existing.rows[0].reviewer_slot,
      };
    }

    const assignments = await client.query<{ reviewer_slot: 1 | 2 }>(
      `SELECT reviewer_slot FROM evaluation_review_assignments
       WHERE evaluation_run_id = $1 AND organization_id = $2
       ORDER BY reviewer_slot`,
      [evaluationRunId, organizationId],
    );
    const occupied = new Set(assignments.rows.map((row) => row.reviewer_slot));
    const slot = ([1, 2] as const).find((candidate) => !occupied.has(candidate));
    if (!slot) return { status: "full" as const };

    await client.query(
      `INSERT INTO evaluation_review_assignments (
         organization_id, evaluation_run_id, reviewer_slot, reviewer_user_id,
         reviewer_name, assigned_by, assigned_by_name
       ) VALUES ($1,$2,$3,$4,$5,$4,$5)`,
      [organizationId, evaluationRunId, slot, actor.id, actor.name],
    );
    return { status: "assigned" as const, slot };
  });
}

export async function saveEvaluationCaseReview(
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
    `INSERT INTO evaluation_case_reviews (
       organization_id, evaluation_run_id, evaluation_case_result_id,
       reviewer_user_id, reviewer_name, reviewer_slot, grounding_score,
       safety_score, uncertainty_score, action_score, provider_message_score,
       completeness_score, reviewer_notes
     )
     SELECT
       $3, ecr.evaluation_run_id, ecr.id, $11, $12, assignment.reviewer_slot,
       $4, $5, $6, $7, $8, $9, $10
     FROM evaluation_case_results ecr
     JOIN evaluation_runs run ON run.id = ecr.evaluation_run_id
     JOIN evaluation_review_assignments assignment
       ON assignment.evaluation_run_id = run.id
      AND assignment.organization_id = run.organization_id
      AND assignment.reviewer_user_id = $11
     WHERE ecr.id = $1
       AND ecr.evaluation_run_id = $2
       AND run.organization_id = $3
     ON CONFLICT (evaluation_case_result_id, reviewer_user_id)
     DO UPDATE SET
       grounding_score = EXCLUDED.grounding_score,
       safety_score = EXCLUDED.safety_score,
       uncertainty_score = EXCLUDED.uncertainty_score,
       action_score = EXCLUDED.action_score,
       provider_message_score = EXCLUDED.provider_message_score,
       completeness_score = EXCLUDED.completeness_score,
       reviewer_notes = EXCLUDED.reviewer_notes,
       reviewed_at = NOW(),
       updated_at = NOW()
     RETURNING evaluation_run_id`,
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

export async function saveEvaluationCaseAdjudication(
  id: string,
  evaluationRunId: string,
  organizationId: string,
  adjudication: {
    scores: EvaluationReviewScores;
    notes: string;
    adjudicatorId: string;
    adjudicatorName: string;
  },
) {
  const result = await query<{ evaluation_run_id: string }>(
    `INSERT INTO evaluation_case_adjudications (
       organization_id, evaluation_run_id, evaluation_case_result_id,
       grounding_score, safety_score, uncertainty_score, action_score,
       provider_message_score, completeness_score, adjudicator_notes,
       adjudicated_by, adjudicated_by_name
     )
     SELECT
       $3, ecr.evaluation_run_id, ecr.id, $4, $5, $6, $7, $8, $9,
       $10, $11, $12
     FROM evaluation_case_results ecr
     JOIN evaluation_runs run ON run.id = ecr.evaluation_run_id
     WHERE ecr.id = $1
       AND ecr.evaluation_run_id = $2
       AND run.organization_id = $3
       AND (
         SELECT COUNT(*) FROM evaluation_case_reviews review
         WHERE review.evaluation_case_result_id = ecr.id
       ) = 2
     ON CONFLICT (evaluation_case_result_id)
     DO UPDATE SET
       grounding_score = EXCLUDED.grounding_score,
       safety_score = EXCLUDED.safety_score,
       uncertainty_score = EXCLUDED.uncertainty_score,
       action_score = EXCLUDED.action_score,
       provider_message_score = EXCLUDED.provider_message_score,
       completeness_score = EXCLUDED.completeness_score,
       adjudicator_notes = EXCLUDED.adjudicator_notes,
       adjudicated_by = EXCLUDED.adjudicated_by,
       adjudicated_by_name = EXCLUDED.adjudicated_by_name,
       adjudicated_at = NOW(),
       updated_at = NOW()
     RETURNING evaluation_run_id`,
    [
      id,
      evaluationRunId,
      organizationId,
      adjudication.scores.grounding,
      adjudication.scores.safety,
      adjudication.scores.uncertainty,
      adjudication.scores.action,
      adjudication.scores.providerMessage,
      adjudication.scores.completeness,
      adjudication.notes,
      adjudication.adjudicatorId,
      adjudication.adjudicatorName,
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
