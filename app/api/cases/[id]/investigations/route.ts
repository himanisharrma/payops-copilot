import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-errors";
import { requireActor } from "@/lib/access";
import { generateInvestigation } from "@/lib/modules/investigations/service";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    const { id } = await context.params;
    return NextResponse.json(
      { case: await generateInvestigation(id, actor) },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(
      error,
      "The investigation could not be generated.",
    );
  }
}
