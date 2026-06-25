import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/access";
import { apiErrorResponse } from "@/lib/api-errors";
import { loadMerchantSettlementWorkspace } from "@/lib/modules/merchant-settlements/service";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireActor();
    return NextResponse.json(
      await loadMerchantSettlementWorkspace(
        actor.organizationId,
        request.nextUrl.searchParams,
      ),
    );
  } catch (error) {
    return apiErrorResponse(
      error,
      "Merchant settlement statements could not be loaded.",
    );
  }
}
