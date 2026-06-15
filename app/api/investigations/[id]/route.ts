import { NextResponse } from "next/server";
import { accessErrorResponse, requireActor } from "@/lib/access";
import { DomainError } from "@/lib/modules/errors";
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
      { error: "The investigation could not be updated." },
      { status: 503 },
    );
  }
}
