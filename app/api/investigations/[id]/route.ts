import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-errors";
import { requireActor } from "@/lib/access";
import { reviewInvestigation } from "@/lib/modules/investigations/service";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    const { id } = await context.params;
    const payload: unknown = await request.json();
    return NextResponse.json({
      case: await reviewInvestigation(id, payload, actor),
    });
  } catch (error) {
    return apiErrorResponse(error, "The investigation could not be updated.");
  }
}
