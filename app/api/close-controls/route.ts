import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-errors";
import { requireActor } from "@/lib/access";
import {
  loadCloseWorkspace,
  submitCloseControl,
} from "@/lib/modules/close-control/service";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireActor();
    return NextResponse.json(
      await loadCloseWorkspace(
        actor.organizationId,
        request.nextUrl.searchParams,
      ),
    );
  } catch (error) {
    return apiErrorResponse(
      error,
      "Reconciliation close controls could not be loaded.",
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    return NextResponse.json(
      await submitCloseControl(await request.json(), actor),
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(
      error,
      "The reconciliation close could not be submitted.",
    );
  }
}
