import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-errors";
import { requireActor } from "@/lib/access";
import {
  changeCase,
  type CasePatch,
} from "@/lib/modules/cases/service";

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
    return apiErrorResponse(error, "The case could not be updated.");
  }
}
