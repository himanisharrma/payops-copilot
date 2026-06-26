import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/access";
import { apiErrorResponse } from "@/lib/api-errors";
import { changeSettlementAdjustment } from "@/lib/modules/settlement-imports/service";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    const { id } = await params;
    const body = await request.json();
    return NextResponse.json(
      await changeSettlementAdjustment({
        actor,
        adjustmentId: id,
        action: body.action,
        reason: body.reason,
      }),
    );
  } catch (error) {
    return apiErrorResponse(error, "Settlement adjustment could not be changed.");
  }
}
