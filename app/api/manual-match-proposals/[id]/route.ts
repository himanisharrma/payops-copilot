import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/access";
import { apiErrorResponse } from "@/lib/api-errors";
import { DomainError } from "@/lib/modules/errors";
import { decideManualUnmatch } from "@/lib/modules/manual-matches/service";
import { decideManualMatchInput } from "@/lib/modules/manual-matches/schema";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    const { id } = await params;
    const body = await request.json();
    const parsed = decideManualMatchInput.safeParse(body);
    if (!parsed.success) {
      throw new DomainError(
        parsed.error.issues[0]?.message ?? "Invalid decision payload.",
        400,
      );
    }
    const result = await decideManualUnmatch({
      actor,
      proposalId: id,
      action: parsed.data.action,
      decisionReason: parsed.data.decisionReason,
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error, "Manual override decision could not be recorded.");
  }
}
