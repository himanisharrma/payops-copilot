import { NextResponse } from "next/server";
import { accessErrorResponse, requireActor } from "@/lib/access";
import {
  changeCase,
  type CasePatch,
} from "@/lib/modules/cases/service";
import { DomainError } from "@/lib/modules/errors";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    const { id } = await context.params;
    const payload = (await request.json()) as CasePatch;
    return NextResponse.json({ case: await changeCase(id, payload, actor) });
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
      { error: "The case could not be updated." },
      { status: 503 },
    );
  }
}
