import { NextResponse } from "next/server";
import { requireActor } from "@/lib/access";
import { apiErrorResponse } from "@/lib/api-errors";
import { refreshMerchantSettlements } from "@/lib/modules/merchant-settlements/service";

export async function POST() {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    return NextResponse.json(await refreshMerchantSettlements(actor));
  } catch (error) {
    return apiErrorResponse(
      error,
      "Merchant settlement statements could not be refreshed.",
    );
  }
}
