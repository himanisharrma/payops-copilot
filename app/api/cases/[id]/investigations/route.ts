import { NextResponse } from "next/server";
import { accessErrorResponse, requireActor } from "@/lib/access";
import { DomainError } from "@/lib/modules/errors";
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
      { error: "The investigation could not be generated." },
      { status: 503 },
    );
  }
}
