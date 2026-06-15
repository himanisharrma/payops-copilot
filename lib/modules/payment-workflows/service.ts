import type { Actor } from "@/lib/access";
import { recordAuditEvent } from "@/lib/modules/audit/repository";
import { DomainError } from "@/lib/modules/errors";
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

export type PaymentWorkflowPatch = {
  status?: PaymentWorkflowStatus;
  priority?: PaymentWorkflow["priority"];
  owner?: string | null;
  notes?: string;
  evidenceChecklist?: EvidenceChecklistItem[];
};

const priorities = new Set<PaymentWorkflow["priority"]>([
  "low",
  "medium",
  "high",
]);

export function validatePaymentWorkflowPatch(
  existing: PaymentWorkflow,
  patch: PaymentWorkflowPatch,
) {
  if (patch.status && !isWorkflowStatus(existing.type, patch.status)) {
    throw new DomainError(
      `Invalid ${existing.type} lifecycle status.`,
      400,
    );
  }
  if (
    patch.status &&
    !canTransitionWorkflow(existing.status, patch.status)
  ) {
    throw new DomainError(
      `Cannot move this workflow from ${existing.status} to ${patch.status}.`,
      400,
    );
  }
  if (patch.priority && !priorities.has(patch.priority)) {
    throw new DomainError("Invalid priority.", 400);
  }
  if (
    patch.evidenceChecklist &&
    !patch.evidenceChecklist.every(
      (item) =>
        typeof item.key === "string" &&
        typeof item.label === "string" &&
        typeof item.complete === "boolean",
    )
  ) {
    throw new DomainError("Invalid evidence checklist.", 400);
  }

  const effectiveChecklist =
    patch.evidenceChecklist ?? existing.evidenceChecklist;
  if (
    patch.status === "evidence_submitted" &&
    !canSubmitChargebackEvidence({
      ...existing,
      evidenceChecklist: effectiveChecklist,
    })
  ) {
    throw new DomainError(
      "Complete every evidence check before submitting a chargeback response.",
      400,
    );
  }
}

export async function changePaymentWorkflow(
  id: string,
  patch: PaymentWorkflowPatch,
  actor: Actor,
) {
  const workflows = await listPaymentWorkflows(actor.organizationId);
  const existing = workflows.find((workflow) => workflow.id === id);
  if (!existing) {
    throw new DomainError("Payment workflow not found.", 404);
  }

  validatePaymentWorkflowPatch(existing, patch);
  const updatedId = await updatePaymentWorkflow(
    id,
    actor.organizationId,
    patch,
    actor.name,
  );
  if (!updatedId) {
    throw new DomainError("Payment workflow not found.", 404);
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
      status: patch.status,
      priority: patch.priority,
      owner: patch.owner,
      evidenceUpdated: Boolean(patch.evidenceChecklist),
    },
  });

  return (await listPaymentWorkflows(actor.organizationId)).find(
    (workflow) => workflow.id === id,
  )!;
}
