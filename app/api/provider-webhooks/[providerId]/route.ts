import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-errors";
import { receiveSyntheticProviderWebhook } from "@/lib/modules/provider-events/service";

export async function POST(
  request: Request,
  context: { params: Promise<{ providerId: string }> },
) {
  try {
    const { providerId } = await context.params;
    const result = await receiveSyntheticProviderWebhook({
      providerId,
      organizationSlug: request.headers.get("x-payops-organization") ?? "",
      externalEventId: request.headers.get("x-payops-event-id") ?? "",
      signature: request.headers.get("x-payops-signature") ?? "",
      rawBody: await request.text(),
    });
    return NextResponse.json(
      {
        status: result.accepted ? "accepted" : "duplicate",
        providerEventId: result.providerEventId,
        matchedRecords: result.matches.length,
      },
      { status: result.accepted ? 202 : 200 },
    );
  } catch (error) {
    return apiErrorResponse(
      error,
      "The synthetic provider event could not be received.",
    );
  }
}
