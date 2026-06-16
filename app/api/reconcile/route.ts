import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-errors";
import { requireActor } from "@/lib/access";
import { createReconciliationRun } from "@/lib/modules/reconciliation/service";

export async function POST(request: Request) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    const payload: unknown = await request.json();
    return NextResponse.json(
      await createReconciliationRun(payload, actor),
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(
      error,
      "The reports could not be saved. Confirm PostgreSQL is running and migrations are applied.",
    );
  }
}
