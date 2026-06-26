import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/access";
import { apiErrorResponse } from "@/lib/api-errors";
import { proposeSettlementAdjustment } from "@/lib/modules/settlement-imports/service";
import type { SettlementAdjustmentType } from "@/lib/modules/settlement-imports/types";

export async function POST(request: NextRequest) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    const body = await request.json();
    return NextResponse.json(
      await proposeSettlementAdjustment({
        actor,
        exceptionId: String(body.exceptionId ?? ""),
        adjustmentType: String(body.adjustmentType ?? "manual_review") as SettlementAdjustmentType,
        amount: Number(body.amount ?? 0),
        reason: String(body.reason ?? ""),
        evidenceReference: String(body.evidenceReference ?? ""),
      }),
    );
  } catch (error) {
    return apiErrorResponse(error, "Settlement adjustment could not be proposed.");
  }
}
