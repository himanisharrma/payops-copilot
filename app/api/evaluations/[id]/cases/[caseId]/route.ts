import { NextResponse } from "next/server";
import { accessErrorResponse, requireActor } from "@/lib/access";
import type { EvaluationReviewScores } from "@/lib/types";
import {
  reviewEvaluation,
} from "@/lib/modules/evaluations/service";
import { DomainError } from "@/lib/modules/errors";

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
    const accessResponse = accessErrorResponse(error);
    if (accessResponse) return accessResponse;
    if (error instanceof DomainError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error(error);
    return NextResponse.json(
      { error: "The evaluation review could not be saved." },
      { status: 503 },
    );
  }
}
