import { NextResponse } from "next/server";
import { requireActor } from "@/lib/access";
import { apiErrorResponse } from "@/lib/api-errors";
import { getSettlementImportDetail } from "@/lib/modules/settlement-imports/service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const detail = await getSettlementImportDetail(id, actor.organizationId);
    if (!detail) {
      return NextResponse.json(
        { error: "Settlement import not found." },
        { status: 404 },
      );
    }
    return NextResponse.json(detail);
  } catch (error) {
    return apiErrorResponse(error, "Settlement import could not be loaded.");
  }
}
