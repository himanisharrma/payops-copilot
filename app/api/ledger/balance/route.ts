import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/access";
import { apiErrorResponse } from "@/lib/api-errors";
import { transaction } from "@/lib/db";
import { DomainError } from "@/lib/modules/errors";
import { getBalance } from "@/lib/modules/ledger/service";
import { balanceQuerySchema } from "@/lib/modules/ledger/schema";

// GET /api/ledger/balance?merchantAccountId=<uuid>&asOf=<iso?>
//
// Returns the merchant's chart-of-accounts balances as of the given
// instant (defaults to now). The wedge per-PG-receivable breakdown
// lives in a separate Slice 6b endpoint
// (GET /api/ledger/provider-receivable) — this route returns the raw
// per-account balances used by tooling and downstream consumers.
// Admin + analyst only.
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
    const balances = await transaction((client) =>
      getBalance(
        client,
        actor.organizationId,
        parsed.data.merchantAccountId,
        asOf,
      ),
    );
    return NextResponse.json({ asOf: asOf.toISOString(), balances });
  } catch (error) {
    return apiErrorResponse(error, "Ledger balance could not be read.");
  }
}
