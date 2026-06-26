import { NextResponse } from "next/server";
import { requireActor } from "@/lib/access";
import { apiErrorResponse } from "@/lib/api-errors";
import { recompareSettlementImport } from "@/lib/modules/settlement-imports/service";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    const { id } = await params;
    return NextResponse.json(await recompareSettlementImport(actor, id));
  } catch (error) {
    return apiErrorResponse(error, "Settlement import could not be compared.");
  }
}
