import { NextResponse } from "next/server";
import { accessErrorResponse, requireActor } from "@/lib/access";
import { getEvaluationRun } from "@/lib/modules/evaluations/repository";

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
