import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-errors";
import { requireActor } from "@/lib/access";
import { getProviderWebhookObservability } from "@/lib/modules/provider-events/repository";

export async function GET() {
  try {
    const actor = await requireActor(["admin"]);
    return NextResponse.json(
      await getProviderWebhookObservability(actor.organizationId),
    );
  } catch (error) {
    return apiErrorResponse(
      error,
      "Webhook delivery evidence is unavailable.",
    );
  }
}
