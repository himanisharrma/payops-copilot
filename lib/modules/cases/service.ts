import type { Actor } from "@/lib/access";
import { recordAuditEvent } from "@/lib/modules/audit/repository";
import { updateCase } from "@/lib/modules/cases/repository";
import { DomainError } from "@/lib/modules/errors";
import type { CaseStatus, OperationsCase } from "@/lib/types";

export type CasePatch = {
  status?: CaseStatus;
  priority?: OperationsCase["priority"];
  owner?: string | null;
  notes?: string;
};

const statuses = new Set<CaseStatus>(["open", "investigating", "resolved"]);
const priorities = new Set<OperationsCase["priority"]>([
  "low",
  "medium",
  "high",
]);

export function validateCasePatch(patch: CasePatch) {
  if (patch.status && !statuses.has(patch.status)) {
    throw new DomainError("Invalid status.", 400);
  }
  if (patch.priority && !priorities.has(patch.priority)) {
    throw new DomainError("Invalid priority.", 400);
  }
}

export async function changeCase(id: string, patch: CasePatch, actor: Actor) {
  validateCasePatch(patch);
  const updated = await updateCase(id, actor.organizationId, patch);
  if (!updated) throw new DomainError("Case not found.", 404);

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.id,
    actorName: actor.name,
    action: "case.updated",
    entityType: "operations_case",
    entityId: id,
    details: {
      ...patch,
      ...(patch.priority ? { dueAt: updated.dueAt } : {}),
      slaStatus: updated.slaStatus,
    },
  });
  return updated;
}
