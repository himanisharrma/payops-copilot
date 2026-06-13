import { NextResponse } from "next/server";
import { recordAuditEvent, updateCase } from "@/lib/repository";
import type { CaseStatus, OperationsCase } from "@/lib/types";
import { accessErrorResponse, requireActor } from "@/lib/access";

const statuses = new Set<CaseStatus>(["open", "investigating", "resolved"]);
const priorities = new Set<OperationsCase["priority"]>([
  "low",
  "medium",
  "high",
]);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    const { id } = await context.params;
    const payload = (await request.json()) as {
      status?: CaseStatus;
      priority?: OperationsCase["priority"];
      owner?: string | null;
      notes?: string;
    };

    if (payload.status && !statuses.has(payload.status)) {
      return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    }
    if (payload.priority && !priorities.has(payload.priority)) {
      return NextResponse.json({ error: "Invalid priority." }, { status: 400 });
    }

    const updated = await updateCase(id, actor.organizationId, payload);
    if (!updated) {
      return NextResponse.json({ error: "Case not found." }, { status: 404 });
    }
    await recordAuditEvent({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      actorName: actor.name,
      action: "case.updated",
      entityType: "operations_case",
      entityId: id,
      details: payload,
    });
    return NextResponse.json({ case: updated });
  } catch (error) {
    const accessResponse = accessErrorResponse(error);
    if (accessResponse) return accessResponse;
    console.error(error);
    return NextResponse.json(
      { error: "The case could not be updated." },
      { status: 503 },
    );
  }
}
