import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-errors";
import { requireActor } from "@/lib/access";
import { listCaseComments } from "@/lib/modules/cases/repository";
import { addCaseComment } from "@/lib/modules/cases/service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    return NextResponse.json({
      comments: await listCaseComments(id, actor.organizationId),
    });
  } catch (error) {
    return apiErrorResponse(error, "Case comments are unavailable.");
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    const { id } = await context.params;
    const payload: unknown = await request.json();
    return NextResponse.json({
      comment: await addCaseComment(id, payload, actor),
    });
  } catch (error) {
    return apiErrorResponse(error, "The comment could not be added.");
  }
}
