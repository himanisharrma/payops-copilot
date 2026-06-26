import { NextResponse } from "next/server";
import { requireActor } from "@/lib/access";
import { apiErrorResponse } from "@/lib/api-errors";
import { buildEvidencePacket } from "@/lib/modules/settlement-imports/service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const packet = await buildEvidencePacket(actor, id);
    return new NextResponse(JSON.stringify(packet, null, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="settlement-import-${id}.json"`,
      },
    });
  } catch (error) {
    return apiErrorResponse(error, "Evidence packet could not be exported.");
  }
}
