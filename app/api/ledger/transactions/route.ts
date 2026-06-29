import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/access";
import { apiErrorResponse } from "@/lib/api-errors";
import { transaction } from "@/lib/db";
import { DomainError } from "@/lib/modules/errors";
import { listTransactions } from "@/lib/modules/ledger/service";
import { transactionsQuerySchema } from "@/lib/modules/ledger/schema";

// GET /api/ledger/transactions?merchantAccountId=<uuid>&from=<iso>&to=<iso>&cursor=<?>&limit=<?>
//
// Keyset-paginated feed of ledger transactions (with their entries)
// for one merchant in a date window. Admin + analyst only. Cursor is
// opaque (base64url of "<effectiveAt>|<id>").
export async function GET(request: NextRequest) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    const url = new URL(request.url);
    const parsed = transactionsQuerySchema.safeParse({
      merchantAccountId: url.searchParams.get("merchantAccountId"),
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      throw new DomainError(
        parsed.error.issues[0]?.message ?? "Invalid transactions query.",
        400,
      );
    }
    const result = await transaction((client) =>
      listTransactions(client, actor.organizationId, {
        merchantAccountId: parsed.data.merchantAccountId,
        from: new Date(parsed.data.from),
        to: new Date(parsed.data.to),
        cursor: parsed.data.cursor,
        limit: parsed.data.limit,
      }),
    );
    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error, "Ledger transactions could not be read.");
  }
}
