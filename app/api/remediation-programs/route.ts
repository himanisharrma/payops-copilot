import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/access";
import { apiErrorResponse } from "@/lib/api-errors";
import {
  loadRemediationWorkspace,
  promoteRecurrenceSuggestion,
} from "@/lib/modules/remediation-programs/service";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireActor();
    return NextResponse.json(
      await loadRemediationWorkspace(
        actor.organizationId,
        request.nextUrl.searchParams,
      ),
    );
  } catch (error) {
    return apiErrorResponse(
      error,
      "Recurring exception programs could not be loaded.",
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    return NextResponse.json(
      await promoteRecurrenceSuggestion(await request.json(), actor),
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(
      error,
      "The remediation program could not be created.",
    );
  }
}
