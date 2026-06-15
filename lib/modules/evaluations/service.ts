import type { Actor } from "@/lib/access";
import { paymentInvestigationDataset } from "@/evals/payment-investigations-v1";
import {
  runDeterministicEvaluation,
  runOpenAIEvaluation,
  summarizeEvaluationScenarios,
} from "@/lib/evaluation";
import { recordAuditEvent } from "@/lib/modules/audit/repository";
import { DomainError } from "@/lib/modules/errors";
import {
  getEvaluationRun,
  listEvaluationRuns,
  reviewEvaluationCase,
  saveEvaluationRun,
} from "@/lib/modules/evaluations/repository";
import type { EvaluationReviewScores } from "@/lib/types";

export type EvaluationProvider = "deterministic" | "openai";

export function parseEvaluationProvider(
  provider: unknown,
): EvaluationProvider {
  const value = provider ?? "deterministic";
  if (value !== "deterministic" && value !== "openai") {
    throw new DomainError(
      "Evaluation provider must be deterministic or openai.",
      400,
    );
  }
  if (value === "openai" && !process.env.OPENAI_API_KEY) {
    throw new DomainError(
      "OpenAI model evaluation is unavailable until OPENAI_API_KEY is configured.",
      409,
    );
  }
  return value;
}

export async function executeEvaluation(
  provider: EvaluationProvider,
  actor: Actor,
) {
  const evaluation =
    provider === "openai"
      ? await runOpenAIEvaluation(paymentInvestigationDataset)
      : runDeterministicEvaluation(paymentInvestigationDataset);
  const scenarios = summarizeEvaluationScenarios(evaluation.results);
  const evaluationId = await saveEvaluationRun(evaluation, scenarios, actor);

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.id,
    actorName: actor.name,
    action: "evaluation.completed",
    entityType: "evaluation_run",
    entityId: evaluationId,
    details: {
      datasetVersion: evaluation.datasetVersion,
      promptVersion: evaluation.promptVersion,
      provider: evaluation.provider,
      model: evaluation.model,
      passRate: evaluation.summary.passRate,
      criticalSafetyFailures: evaluation.summary.criticalSafetyFailures,
      durationMs: evaluation.durationMs,
      totalTokens: evaluation.usage.totalTokens,
    },
  });

  return listEvaluationRuns(actor.organizationId);
}

const validScore = (score: unknown) =>
  typeof score === "number" &&
  Number.isInteger(score) &&
  score >= 0 &&
  score <= 2;

export function validateEvaluationReview(scores?: EvaluationReviewScores) {
  if (
    !scores ||
    ![
      scores.grounding,
      scores.safety,
      scores.uncertainty,
      scores.action,
      scores.providerMessage,
      scores.completeness,
    ].every(validScore)
  ) {
    throw new DomainError(
      "All six review scores must be integers from 0 to 2.",
      400,
    );
  }
}

export async function reviewEvaluation(
  evaluationId: string,
  caseId: string,
  input: { scores?: EvaluationReviewScores; notes?: string },
  actor: Actor,
) {
  validateEvaluationReview(input.scores);
  const scores = input.scores!;
  const runId = await reviewEvaluationCase(
    caseId,
    evaluationId,
    actor.organizationId,
    {
      scores,
      notes: input.notes?.trim() ?? "",
      reviewerId: actor.id,
      reviewerName: actor.name,
    },
  );
  if (!runId) throw new DomainError("Evaluation case not found.", 404);

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.id,
    actorName: actor.name,
    action: "evaluation_case.reviewed",
    entityType: "evaluation_case_result",
    entityId: caseId,
    details: { evaluationRunId: evaluationId, scores },
  });

  return getEvaluationRun(evaluationId, actor.organizationId);
}
