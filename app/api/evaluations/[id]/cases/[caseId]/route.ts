import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-errors";
import { requireActor } from "@/lib/access";
import type { EvaluationReviewScores } from "@/lib/types";
import {
  reviewEvaluation,
} from "@/lib/modules/evaluations/service";

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
    return NextResponse.json({
      run: await reviewEvaluation(id, caseId, payload, actor),
    });
  } catch (error) {
    return apiErrorResponse(
      error,
      "The evaluation review could not be saved.",
    );
  }
}
