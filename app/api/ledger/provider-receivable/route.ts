import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/access";
import { apiErrorResponse } from "@/lib/api-errors";
import { transaction } from "@/lib/db";
import { DomainError } from "@/lib/modules/errors";
import { getProviderReceivableBreakdown } from "@/lib/modules/ledger/service";
import { providerReceivableQuerySchema } from "@/lib/modules/ledger/schema";

// GET /api/ledger/provider-receivable?merchantAccountId=<uuid>&batchId=<uuid>
//
// Returns the per-PG receivable breakdown for one settlement batch —
// the wedge read powering the per-PG card on the settlement detail
// drawer. Admin + analyst. Each settlement batch already corresponds
// to one provider (merchant_settlement_batches.provider_id), so the
// breakdown is single-card-per-batch.
export async function GET(request: NextRequest) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    const url = new URL(request.url);
    const parsed = providerReceivableQuerySchema.safeParse({
      merchantAccountId: url.searchParams.get("merchantAccountId"),
      batchId: url.searchParams.get("batchId"),
    });
    if (!parsed.success) {
      throw new DomainError(
        parsed.error.issues[0]?.message
          ?? "Invalid provider-receivable query.",
        400,
      );
    }
    const breakdown = await transaction((client) =>
      getProviderReceivableBreakdown(
        client,
        actor.organizationId,
        parsed.data.merchantAccountId,
        parsed.data.batchId,
      ),
    );
    return NextResponse.json(breakdown);
  } catch (error) {
    return apiErrorResponse(
      error,
      "Provider receivable breakdown could not be read.",
    );
  }
}
