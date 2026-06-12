import { NextResponse } from "next/server";
import { reconcilePayments } from "@/lib/reconciliation";
import { saveReconciliationRun } from "@/lib/repository";
import type { ReconciliationRequest } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as ReconciliationRequest;

    if (!payload.orders || !payload.gateway || !payload.settlements) {
      return NextResponse.json(
        { error: "Orders, gateway, and settlement records are required." },
        { status: 400 },
      );
    }

    const result = reconcilePayments(payload);
    const stored = await saveReconciliationRun(result, {
      name:
        payload.runName ??
        `Reconciliation ${new Date().toLocaleDateString("en-IN")}`,
      sourceType: payload.sourceType ?? "upload",
      sourceFiles: payload.sourceFiles ?? {},
    });
    return NextResponse.json(stored, { status: 201 });
  } catch (error) {
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
