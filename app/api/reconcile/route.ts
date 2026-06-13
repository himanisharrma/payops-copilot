import { NextResponse } from "next/server";
import { reconcilePayments } from "@/lib/reconciliation";
import { recordAuditEvent, saveReconciliationRun } from "@/lib/repository";
import type { ReconciliationRequest } from "@/lib/types";
import { accessErrorResponse, requireActor } from "@/lib/access";

export async function POST(request: Request) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    const payload = (await request.json()) as ReconciliationRequest;

    if (!payload.orders || !payload.gateway || !payload.settlements) {
      return NextResponse.json(
        { error: "Orders, gateway, and settlement records are required." },
        { status: 400 },
      );
    }

    const result = reconcilePayments(payload);
    const stored = await saveReconciliationRun(result, {
      organizationId: actor.organizationId,
      name:
        payload.runName ??
        `Reconciliation ${new Date().toLocaleDateString("en-IN")}`,
      sourceType: payload.sourceType ?? "upload",
      sourceFiles: payload.sourceFiles ?? {},
    });
    await recordAuditEvent({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      actorName: actor.name,
      action: "reconciliation.created",
      entityType: "reconciliation_run",
      entityId: stored.id!,
      details: {
        totalOrders: stored.summary.totalOrders,
        exceptionCount: stored.summary.exceptionCount,
      },
    });
    return NextResponse.json(stored, { status: 201 });
  } catch (error) {
    const accessResponse = accessErrorResponse(error);
    if (accessResponse) return accessResponse;
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
