import type {
  PaymentWorkflow,
  PaymentWorkflowStatus,
  PaymentWorkflowType,
} from "@/lib/types";

export const workflowStatuses: Record<
  PaymentWorkflowType,
  PaymentWorkflowStatus[]
> = {
  refund: [
    "requested",
    "approved",
    "processing",
    "completed",
    "rejected",
  ],
  chargeback: [
    "received",
    "evidence_due",
    "evidence_submitted",
    "won",
    "lost",
    "accepted",
  ],
};

export const terminalWorkflowStatuses = new Set<PaymentWorkflowStatus>([
  "completed",
  "rejected",
  "won",
  "lost",
  "accepted",
]);

export const workflowTransitions: Record<
  PaymentWorkflowStatus,
  PaymentWorkflowStatus[]
> = {
  requested: ["approved", "rejected"],
  approved: ["processing", "rejected"],
  processing: ["completed"],
  completed: [],
  rejected: [],
  received: ["evidence_due", "accepted"],
  evidence_due: ["evidence_submitted", "accepted"],
  evidence_submitted: ["won", "lost"],
  won: [],
  lost: [],
  accepted: [],
};

export function isWorkflowStatus(
  type: PaymentWorkflowType,
  status: string,
): status is PaymentWorkflowStatus {
  return workflowStatuses[type].includes(status as PaymentWorkflowStatus);
}

export function canTransitionWorkflow(
  current: PaymentWorkflowStatus,
  next: PaymentWorkflowStatus,
) {
  return current === next || workflowTransitions[current].includes(next);
}

export function checklistProgress(workflow: PaymentWorkflow) {
  const total = workflow.evidenceChecklist.length;
  const complete = workflow.evidenceChecklist.filter(
    (item) => item.complete,
  ).length;
  return {
    complete,
    total,
    percent: total ? Math.round((complete / total) * 100) : 0,
  };
}

export function workflowDeadlineState(workflow: PaymentWorkflow) {
  if (terminalWorkflowStatuses.has(workflow.status)) return "closed" as const;
  const remaining = new Date(workflow.dueAt).getTime() - Date.now();
  if (remaining <= 0) return "overdue" as const;
  if (remaining <= 6 * 60 * 60 * 1000) return "due_soon" as const;
  return "on_track" as const;
}

export function canSubmitChargebackEvidence(workflow: PaymentWorkflow) {
  return (
    workflow.type === "chargeback" &&
    workflow.evidenceChecklist.length > 0 &&
    workflow.evidenceChecklist.every((item) => item.complete)
  );
}
