import { NextResponse } from "next/server";
import { investigateCase } from "@/lib/ai-investigator";
import {
  getCase,
  recordAuditEvent,
  saveInvestigation,
} from "@/lib/repository";
import { accessErrorResponse, requireActor } from "@/lib/access";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    const { id } = await context.params;
    const paymentCase = await getCase(id, actor.organizationId);
    if (!paymentCase) {
      return NextResponse.json({ error: "Case not found." }, { status: 404 });
    }

    const result = await investigateCase(paymentCase);
    const investigationId = await saveInvestigation(id, result.analysis, result);
    await recordAuditEvent({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      actorName: actor.name,
      action: "investigation.generated",
      entityType: "ai_investigation",
      entityId: investigationId,
      details: { provider: result.provider, model: result.model, caseId: id },
    });
    return NextResponse.json(
      { case: await getCase(id, actor.organizationId) },
      { status: 201 },
    );
  } catch (error) {
    const accessResponse = accessErrorResponse(error);
    if (accessResponse) return accessResponse;
    console.error(error);
    return NextResponse.json(
      { error: "The investigation could not be generated." },
      { status: 503 },
    );
  }
}
