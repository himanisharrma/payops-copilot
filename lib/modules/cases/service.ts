import type { Actor } from "@/lib/access";
import { transaction } from "@/lib/db";
import { recordAuditEvent } from "@/lib/modules/audit/repository";
import {
  bulkAssignCases,
  createCaseComment,
  getCase,
  updateCase,
} from "@/lib/modules/cases/repository";
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
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type BulkAssignmentInput = {
  caseIds: string[];
  owner: string | null;
};

export function validateBulkAssignment(
  input: unknown,
): asserts input is BulkAssignmentInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new DomainError("Bulk assignment must be an object.", 400);
  }
  const value = input as Partial<BulkAssignmentInput>;
  if (
    !Array.isArray(value.caseIds) ||
    value.caseIds.length === 0 ||
    value.caseIds.length > 100 ||
    value.caseIds.some(
      (id) => typeof id !== "string" || !uuidPattern.test(id),
    )
  ) {
    throw new DomainError("Select between 1 and 100 cases.", 400);
  }
  if (
    value.owner !== null &&
    (typeof value.owner !== "string" || value.owner.trim().length > 120)
  ) {
    throw new DomainError("Owner must be 120 characters or fewer.", 400);
  }
}

export function validateCaseComment(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new DomainError("Comment must be an object.", 400);
  }
  const body = (input as { body?: unknown }).body;
  if (typeof body !== "string" || !body.trim()) {
    throw new DomainError("Comment text is required.", 400);
  }
  if (body.trim().length > 2000) {
    throw new DomainError("Comment must be 2,000 characters or fewer.", 400);
  }
  return body.trim();
}

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

export async function assignCases(input: unknown, actor: Actor) {
  validateBulkAssignment(input);
  const uniqueIds = [...new Set(input.caseIds)];
  const owner = input.owner?.trim() || null;
  return transaction(async (client) => {
    const updatedIds = await bulkAssignCases(
      client,
      uniqueIds,
      actor.organizationId,
      owner,
    );
    if (updatedIds.length !== uniqueIds.length) {
      throw new DomainError(
        "One or more selected cases are unavailable.",
        404,
      );
    }
    await recordAuditEvent(
      {
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        actorName: actor.name,
        action: "case.bulk_assigned",
        entityType: "operations_case_batch",
        entityId: updatedIds.join(","),
        details: { caseIds: updatedIds, owner, count: updatedIds.length },
      },
      client,
    );
    return { updatedIds, owner };
  });
}

export async function addCaseComment(
  caseId: string,
  input: unknown,
  actor: Actor,
) {
  const body = validateCaseComment(input);
  return transaction(async (client) => {
    const comment = await createCaseComment(client, {
      caseId,
      organizationId: actor.organizationId,
      authorUserId: actor.id,
      authorName: actor.name,
      body,
    });
    if (!comment) throw new DomainError("Case not found.", 404);
    await recordAuditEvent(
      {
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        actorName: actor.name,
        action: "case.comment_added",
        entityType: "operations_case",
        entityId: caseId,
        details: { commentId: comment.id, characters: body.length },
      },
      client,
    );
    return comment;
  });
}
