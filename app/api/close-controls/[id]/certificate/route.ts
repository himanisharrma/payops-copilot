import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-errors";
import { requireActor } from "@/lib/access";
import { getCloseCertificate } from "@/lib/modules/close-control/service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    const certificate = await getCloseCertificate(id, actor);
    return new NextResponse(JSON.stringify(certificate, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="payops-close-${certificate.period.businessDate}.json"`,
      },
    });
  } catch (error) {
    return apiErrorResponse(
      error,
      "The reconciliation close certificate could not be generated.",
    );
  }
}
