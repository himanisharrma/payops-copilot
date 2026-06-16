import type { Actor } from "@/lib/access";
import { recordAuditEvent } from "@/lib/modules/audit/repository";
import { DomainError } from "@/lib/modules/errors";
import { saveReconciliationRun } from "@/lib/modules/reconciliation/repository";
import { reconcilePayments } from "@/lib/reconciliation";
import type {
  RawRecord,
  ReconciliationRequest,
} from "@/lib/types";

export function validateReconciliationRequest(
  input: unknown,
): asserts input is ReconciliationRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new DomainError("Reconciliation request must be an object.", 400);
  }

  const payload = input as Partial<ReconciliationRequest>;
  if (
    !isRecordArray(payload.orders) ||
    !isRecordArray(payload.gateway) ||
    !isRecordArray(payload.settlements)
  ) {
    throw new DomainError(
      "Orders, gateway, and settlement records are required.",
      400,
    );
  }
  if (
    payload.sourceType !== undefined &&
    payload.sourceType !== "demo" &&
    payload.sourceType !== "upload"
  ) {
    throw new DomainError("Source type must be demo or upload.", 400);
  }
  if (
    payload.runName !== undefined &&
    typeof payload.runName !== "string"
  ) {
    throw new DomainError("Run name must be text.", 400);
  }
  if (
    payload.sourceFiles !== undefined &&
    (!payload.sourceFiles ||
      typeof payload.sourceFiles !== "object" ||
      Array.isArray(payload.sourceFiles))
  ) {
    throw new DomainError("Source files metadata must be an object.", 400);
  }
}

export async function createReconciliationRun(
  input: unknown,
  actor: Actor,
) {
  validateReconciliationRequest(input);
  const result = reconcilePayments(input);
  const stored = await saveReconciliationRun(result, {
    organizationId: actor.organizationId,
    name:
      input.runName?.trim() ||
      `Reconciliation ${new Date().toLocaleDateString("en-IN")}`,
    sourceType: input.sourceType ?? "upload",
    sourceFiles: input.sourceFiles ?? {},
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

  return stored;
}

function isRecordArray(value: unknown): value is RawRecord[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) => item !== null && typeof item === "object" && !Array.isArray(item),
    )
  );
}
