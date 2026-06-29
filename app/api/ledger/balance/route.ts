import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/access";
import { apiErrorResponse } from "@/lib/api-errors";
import { transaction } from "@/lib/db";
import { DomainError } from "@/lib/modules/errors";
import { getBalanceWithFormula } from "@/lib/modules/ledger/service";
import { balanceQuerySchema } from "@/lib/modules/ledger/schema";

// GET /api/ledger/balance?merchantAccountId=<uuid>&asOf=<iso?>
//
// Returns the merchant's chart-of-accounts balances as of the given
// instant (defaults to now) plus the 8-term formula breakdown the
// wedge widget renders. Admin + analyst only.
export async function GET(request: NextRequest) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    const url = new URL(request.url);
    const parsed = balanceQuerySchema.safeParse({
      merchantAccountId: url.searchParams.get("merchantAccountId"),
      asOf: url.searchParams.get("asOf") ?? undefined,
    });
    if (!parsed.success) {
      throw new DomainError(
        parsed.error.issues[0]?.message ?? "Invalid balance query.",
        400,
      );
    }
    const asOf = parsed.data.asOf ? new Date(parsed.data.asOf) : new Date();
    const result = await transaction((client) =>
      getBalanceWithFormula(
        client,
        actor.organizationId,
        parsed.data.merchantAccountId,
        asOf,
      ),
    );
    return NextResponse.json({ asOf: asOf.toISOString(), ...result });
  } catch (error) {
    return apiErrorResponse(error, "Ledger balance could not be read.");
  }
}
