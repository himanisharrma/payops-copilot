import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/access";
import { apiErrorResponse } from "@/lib/api-errors";
import { getMerchantSettlement } from "@/lib/modules/merchant-settlements/service";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    const settlement = await getMerchantSettlement(id, actor.organizationId);
    if (!settlement) {
      return NextResponse.json(
        { error: "Merchant settlement statement not found." },
        { status: 404 },
      );
    }
    return NextResponse.json(settlement);
  } catch (error) {
    return apiErrorResponse(
      error,
      "The merchant settlement statement could not be loaded.",
    );
  }
}
