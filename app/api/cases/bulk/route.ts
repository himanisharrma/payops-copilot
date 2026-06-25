import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-errors";
import { requireActor } from "@/lib/access";
import { assignCases } from "@/lib/modules/cases/service";

export async function PATCH(request: Request) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    const payload: unknown = await request.json();
    return NextResponse.json(await assignCases(payload, actor));
  } catch (error) {
    return apiErrorResponse(error, "The cases could not be assigned.");
  }
}
