import type { Actor } from "@/lib/access";
import { transaction } from "@/lib/db";
import { recordAuditEvent } from "@/lib/modules/audit/repository";
import { getCase, updateCase } from "@/lib/modules/cases/repository";
import { DomainError } from "@/lib/modules/errors";
import type { CaseStatus, OperationsCase } from "@/lib/types";

export type CasePatch = {
  status?: CaseStatus;
  priority?: OperationsCase["priority"];
  owner?: string | null;
  notes?: string;
  resolutionReason?: string;
  resolutionEvidenceConfirmed?: boolean;
};

const statuses = new Set<CaseStatus>(["open", "investigating", "resolved"]);
const priorities = new Set<OperationsCase["priority"]>([
  "low",
  "medium",
  "high",
]);

export function validateCasePatch(input: unknown): asserts input is CasePatch {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new DomainError("Case update must be an object.", 400);
  }
  const patch = input as CasePatch;
  if (patch.status && !statuses.has(patch.status)) {
    throw new DomainError("Invalid status.", 400);
  }
  if (patch.priority && !priorities.has(patch.priority)) {
    throw new DomainError("Invalid priority.", 400);
  }
  if (
    patch.owner !== undefined &&
    patch.owner !== null &&
    typeof patch.owner !== "string"
  ) {
    throw new DomainError("Owner must be text.", 400);
  }
  if (patch.notes !== undefined && typeof patch.notes !== "string") {
    throw new DomainError("Notes must be text.", 400);
  }
  if (
    patch.resolutionReason !== undefined &&
    typeof patch.resolutionReason !== "string"
  ) {
    throw new DomainError("Resolution reason must be text.", 400);
  }
  if (
    patch.resolutionEvidenceConfirmed !== undefined &&
    typeof patch.resolutionEvidenceConfirmed !== "boolean"
  ) {
    throw new DomainError("Evidence confirmation must be true or false.", 400);
  }
}

export function validateCaseResolution(
  paymentCase: OperationsCase,
  patch: CasePatch,
) {
  if (patch.status !== "resolved") return;
  if (paymentCase.sourceEvidence.length === 0) {
    throw new DomainError(
      "This case has no durable source evidence and cannot be resolved.",
      409,
    );
  }
  if ((patch.resolutionReason?.trim().length ?? 0) < 10) {
    throw new DomainError(
      "Provide a resolution reason of at least 10 characters.",
      400,
    );
  }
  if (patch.resolutionEvidenceConfirmed !== true) {
    throw new DomainError(
      "Confirm that the source evidence was reviewed before resolving.",
      400,
    );
  }
}

export async function changeCase(id: string, input: unknown, actor: Actor) {
  validateCasePatch(input);
  return transaction(async (client) => {
    const existing = await getCase(id, actor.organizationId, client);
    if (!existing) throw new DomainError("Case not found.", 404);
    validateCaseResolution(existing, input);

    const updated = await updateCase(client, id, actor.organizationId, {
      ...input,
      ...(input.status === "resolved"
        ? {
            resolutionReason: input.resolutionReason!.trim(),
            resolvedByUserId: actor.id,
            resolvedByName: actor.name,
          }
        : {}),
    });
    if (!updated) throw new DomainError("Case not found.", 404);

    await recordAuditEvent({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      actorName: actor.name,
      action:
        input.status === "resolved" ? "case.resolved" : "case.updated",
      entityType: "operations_case",
      entityId: id,
      details: {
        ...input,
        ...(input.priority ? { dueAt: updated.dueAt } : {}),
        ...(input.status === "resolved"
          ? {
              sourceEvidenceRows: existing.sourceEvidence.length,
              resolvedByName: actor.name,
            }
          : {}),
        slaStatus: updated.slaStatus,
      },
    }, client);
    return updated;
  });
}
