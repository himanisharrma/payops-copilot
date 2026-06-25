import { NextResponse } from "next/server";
import { requireActor } from "@/lib/access";
import { apiErrorResponse } from "@/lib/api-errors";
import { loadInsights } from "@/lib/modules/insights/service";

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    return NextResponse.json(
      await loadInsights(
        actor.organizationId,
        new URL(request.url).searchParams,
      ),
    );
  } catch (error) {
    return apiErrorResponse(
      error,
      "Operations intelligence is unavailable.",
    );
  }
}
