import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-errors";
import { requireActor } from "@/lib/access";
import {
  adjudicateEvaluation,
  reviewEvaluation,
} from "@/lib/modules/evaluations/service";
import type { EvaluationReviewScores } from "@/lib/types";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; caseId: string }> },
) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    const { id, caseId } = await context.params;
    const payload: {
      action?: "review" | "adjudicate";
      scores?: EvaluationReviewScores;
      notes?: string;
    } = await request.json();
    const action = payload.action ?? "review";
    if (action === "adjudicate") {
      return NextResponse.json({
        run: await adjudicateEvaluation(id, caseId, payload, actor),
      });
    }
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
