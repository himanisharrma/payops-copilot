import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/access";
import { apiErrorResponse } from "@/lib/api-errors";
import {
  loadSourceReadinessSnapshots,
  persistSourceReadinessSnapshot,
} from "@/lib/modules/source-ingestion/service";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireActor();
    return NextResponse.json(await loadSourceReadinessSnapshots(
      actor.organizationId, request.nextUrl.searchParams,
    ));
  } catch (error) {
    return apiErrorResponse(error, "Readiness snapshots could not be loaded.");
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    const body = await request.json();
    return NextResponse.json(await persistSourceReadinessSnapshot({
      actor,
      businessDate: String(body.businessDate ?? ""),
    }));
  } catch (error) {
    return apiErrorResponse(error, "Readiness snapshot could not be created.");
  }
}
