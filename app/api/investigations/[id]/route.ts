import { NextResponse } from "next/server";
import { recordAuditEvent, updateInvestigation } from "@/lib/repository";
import type {
  AIInvestigation,
  InvestigationApproval,
} from "@/lib/types";
import { accessErrorResponse, requireActor } from "@/lib/access";

const approvals = new Set<InvestigationApproval>([
  "pending",
  "approved",
  "rejected",
]);
const ratings = new Set<NonNullable<AIInvestigation["feedbackRating"]>>([
  "helpful",
  "not_helpful",
]);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    const { id } = await context.params;
    const payload = (await request.json()) as {
      approvalStatus?: InvestigationApproval;
      feedbackRating?: AIInvestigation["feedbackRating"];
      feedbackNotes?: string;
    };
    if (
      payload.approvalStatus &&
      !approvals.has(payload.approvalStatus)
    ) {
      return NextResponse.json({ error: "Invalid approval." }, { status: 400 });
    }
    if (payload.feedbackRating && !ratings.has(payload.feedbackRating)) {
      return NextResponse.json({ error: "Invalid rating." }, { status: 400 });
    }

    const updated = await updateInvestigation(
      id,
      actor.organizationId,
      payload,
    );
    if (!updated) {
      return NextResponse.json(
        { error: "Investigation not found." },
        { status: 404 },
      );
    }
    await recordAuditEvent({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      actorName: actor.name,
      action: "investigation.reviewed",
      entityType: "ai_investigation",
      entityId: id,
      details: payload,
    });
    return NextResponse.json({ case: updated });
  } catch (error) {
    const accessResponse = accessErrorResponse(error);
    if (accessResponse) return accessResponse;
    console.error(error);
    return NextResponse.json(
      { error: "The investigation could not be updated." },
      { status: 503 },
    );
  }
}
