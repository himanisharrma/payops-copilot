import { NextResponse } from "next/server";
import { accessErrorResponse, requireActor } from "@/lib/access";
import { apiErrorResponse } from "@/lib/api-errors";
import { getEvaluationRun } from "@/lib/modules/evaluations/repository";
import { claimEvaluationReviewSlot } from "@/lib/modules/evaluations/service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    const run = await getEvaluationRun(id, actor.organizationId);
    if (!run) {
      return NextResponse.json(
        { error: "Evaluation run not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({ run });
  } catch (error) {
    const accessResponse = accessErrorResponse(error);
    if (accessResponse) return accessResponse;
    return NextResponse.json(
      { error: "Evaluation details are unavailable." },
      { status: 503 },
    );
  }
}

export async function PATCH(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    const { id } = await context.params;
    return NextResponse.json({
      run: await claimEvaluationReviewSlot(id, actor),
    });
  } catch (error) {
    return apiErrorResponse(
      error,
      "The reviewer slot could not be assigned.",
    );
  }
}
