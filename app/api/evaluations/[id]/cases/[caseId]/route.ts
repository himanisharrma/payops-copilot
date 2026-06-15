import { NextResponse } from "next/server";
import { accessErrorResponse, requireActor } from "@/lib/access";
import type { EvaluationReviewScores } from "@/lib/types";
import { recordAuditEvent } from "@/lib/modules/audit/repository";
import {
  getEvaluationRun,
  reviewEvaluationCase,
} from "@/lib/modules/evaluations/repository";

const validScore = (score: unknown) =>
  typeof score === "number" && Number.isInteger(score) && score >= 0 && score <= 2;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; caseId: string }> },
) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    const { id, caseId } = await context.params;
    const payload = (await request.json()) as {
      scores?: EvaluationReviewScores;
      notes?: string;
    };
    const scores = payload.scores;
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
      return NextResponse.json(
        { error: "All six review scores must be integers from 0 to 2." },
        { status: 400 },
      );
    }

    const runId = await reviewEvaluationCase(
      caseId,
      id,
      actor.organizationId,
      {
        scores,
        notes: payload.notes?.trim() ?? "",
        reviewerId: actor.id,
        reviewerName: actor.name,
      },
    );
    if (!runId) {
      return NextResponse.json(
        { error: "Evaluation case not found." },
        { status: 404 },
      );
    }

    await recordAuditEvent({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      actorName: actor.name,
      action: "evaluation_case.reviewed",
      entityType: "evaluation_case_result",
      entityId: caseId,
      details: { evaluationRunId: id, scores },
    });

    return NextResponse.json({
      run: await getEvaluationRun(id, actor.organizationId),
    });
  } catch (error) {
    const accessResponse = accessErrorResponse(error);
    if (accessResponse) return accessResponse;
    console.error(error);
    return NextResponse.json(
      { error: "The evaluation review could not be saved." },
      { status: 503 },
    );
  }
}
