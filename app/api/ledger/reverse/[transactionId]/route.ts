import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/access";
import { apiErrorResponse } from "@/lib/api-errors";
import { transaction } from "@/lib/db";
import { DomainError } from "@/lib/modules/errors";
import { reverseTransaction } from "@/lib/modules/ledger/service";
import { reverseBodySchema } from "@/lib/modules/ledger/schema";

// POST /api/ledger/reverse/[transactionId]
//
// Reverses one ledger transaction by appending an inverse pair. Admin
// only — reversals are an audit-grade event and must not be analyst-
// gated. Idempotent on `reverse:<originalId>` (see Slice 6a's
// reverseTransaction service).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ transactionId: string }> },
) {
  try {
    const actor = await requireActor(["admin"]);
    const { transactionId } = await params;
    const body = await request.json();
    const parsed = reverseBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainError(
        parsed.error.issues[0]?.message ?? "Invalid reversal request.",
        400,
      );
    }
    const result = await transaction((client) =>
      reverseTransaction(
        client,
        actor.organizationId,
        transactionId,
        parsed.data.reason,
        { id: actor.id, name: actor.name },
      ),
    );
    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error, "Ledger reversal could not be posted.");
  }
}
