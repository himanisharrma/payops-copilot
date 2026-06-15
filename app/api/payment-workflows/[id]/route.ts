import { NextResponse } from "next/server";
import { accessErrorResponse, requireActor } from "@/lib/access";
import { recordAuditEvent } from "@/lib/modules/audit/repository";
import {
  listPaymentWorkflows,
  updatePaymentWorkflow,
} from "@/lib/modules/payment-workflows/repository";
import {
  canSubmitChargebackEvidence,
  canTransitionWorkflow,
  isWorkflowStatus,
} from "@/lib/payment-workflow";
import type {
  EvidenceChecklistItem,
  PaymentWorkflow,
  PaymentWorkflowStatus,
} from "@/lib/types";

const priorities = new Set<PaymentWorkflow["priority"]>([
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
    const workflows = await listPaymentWorkflows(actor.organizationId);
    const existing = workflows.find((workflow) => workflow.id === id);
    if (!existing) {
      return NextResponse.json(
        { error: "Payment workflow not found." },
        { status: 404 },
      );
    }

    const payload = (await request.json()) as {
      status?: PaymentWorkflowStatus;
      priority?: PaymentWorkflow["priority"];
      owner?: string | null;
      notes?: string;
      evidenceChecklist?: EvidenceChecklistItem[];
    };

    if (payload.status && !isWorkflowStatus(existing.type, payload.status)) {
      return NextResponse.json(
        { error: `Invalid ${existing.type} lifecycle status.` },
        { status: 400 },
      );
    }
    if (
      payload.status &&
      !canTransitionWorkflow(existing.status, payload.status)
    ) {
      return NextResponse.json(
        {
          error: `Cannot move this workflow from ${existing.status} to ${payload.status}.`,
        },
        { status: 400 },
      );
    }
    if (payload.priority && !priorities.has(payload.priority)) {
      return NextResponse.json({ error: "Invalid priority." }, { status: 400 });
    }
    if (
      payload.evidenceChecklist &&
      !payload.evidenceChecklist.every(
        (item) =>
          typeof item.key === "string" &&
          typeof item.label === "string" &&
          typeof item.complete === "boolean",
      )
    ) {
      return NextResponse.json(
        { error: "Invalid evidence checklist." },
        { status: 400 },
      );
    }
    const effectiveChecklist =
      payload.evidenceChecklist ?? existing.evidenceChecklist;
    if (
      payload.status === "evidence_submitted" &&
      !canSubmitChargebackEvidence({
        ...existing,
        evidenceChecklist: effectiveChecklist,
      })
    ) {
      return NextResponse.json(
        {
          error:
            "Complete every evidence check before submitting a chargeback response.",
        },
        { status: 400 },
      );
    }

    const updatedId = await updatePaymentWorkflow(
      id,
      actor.organizationId,
      payload,
      actor.name,
    );
    if (!updatedId) {
      return NextResponse.json(
        { error: "Payment workflow not found." },
        { status: 404 },
      );
    }

    await recordAuditEvent({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      actorName: actor.name,
      action: "payment_workflow.updated",
      entityType: existing.type,
      entityId: id,
      details: {
        externalReference: existing.externalReference,
        status: payload.status,
        priority: payload.priority,
        owner: payload.owner,
        evidenceUpdated: Boolean(payload.evidenceChecklist),
      },
    });

    const updated = (await listPaymentWorkflows(actor.organizationId)).find(
      (workflow) => workflow.id === id,
    );
    return NextResponse.json({ workflow: updated });
  } catch (error) {
    const accessResponse = accessErrorResponse(error);
    if (accessResponse) return accessResponse;
    console.error(error);
    return NextResponse.json(
      { error: "The payment workflow could not be updated." },
      { status: 503 },
    );
  }
}
