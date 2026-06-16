import { NextResponse } from "next/server";
import { accessErrorResponse, requireActor } from "@/lib/access";
import { DomainError } from "@/lib/modules/errors";
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
    const accessResponse = accessErrorResponse(error);
    if (accessResponse) return accessResponse;
    if (error instanceof DomainError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error(error);
    return NextResponse.json(
      {
        error:
          "The reports could not be saved. Confirm PostgreSQL is running and migrations are applied.",
      },
      { status: 503 },
    );
  }
}
