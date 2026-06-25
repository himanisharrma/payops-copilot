import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-errors";
import { requireActor } from "@/lib/access";
import { refreshSettlementControl } from "@/lib/modules/settlement-control/service";

export async function POST() {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    return NextResponse.json(await refreshSettlementControl(actor));
  } catch (error) {
    return apiErrorResponse(
      error,
      "Settlement clocks could not be refreshed.",
    );
  }
}
