import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-errors";
import { requireActor } from "@/lib/access";
import { changeCloseControl } from "@/lib/modules/close-control/service";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    const { id } = await context.params;
    return NextResponse.json(
      await changeCloseControl(id, await request.json(), actor),
    );
  } catch (error) {
    return apiErrorResponse(
      error,
      "The reconciliation close could not be updated.",
    );
  }
}
