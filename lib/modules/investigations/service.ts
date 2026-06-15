import type { Actor } from "@/lib/access";
import { investigateCase } from "@/lib/ai-investigator";
import { recordAuditEvent } from "@/lib/modules/audit/repository";
import { getCase } from "@/lib/modules/cases/repository";
import { DomainError } from "@/lib/modules/errors";
import {
  saveInvestigation,
  updateInvestigation,
} from "@/lib/modules/investigations/repository";
import type {
  AIInvestigation,
  InvestigationApproval,
} from "@/lib/types";

export type InvestigationReviewPatch = {
  approvalStatus?: InvestigationApproval;
  feedbackRating?: NonNullable<AIInvestigation["feedbackRating"]>;
  feedbackNotes?: string;
};

const approvals = new Set<InvestigationApproval>([
  "pending",
  "approved",
  "rejected",
]);
const ratings = new Set<NonNullable<AIInvestigation["feedbackRating"]>>([
  "helpful",
  "not_helpful",
]);

export function validateInvestigationReview(
  patch: unknown,
): asserts patch is InvestigationReviewPatch {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new DomainError("Investigation review must be an object.", 400);
  }

  const input = patch as Record<string, unknown>;
  const supportedFields = [
    "approvalStatus",
    "feedbackRating",
    "feedbackNotes",
  ];
  if (!supportedFields.some((field) => field in input)) {
    throw new DomainError("Provide an investigation review change.", 400);
  }
  if (
    input.approvalStatus !== undefined &&
    !approvals.has(input.approvalStatus as InvestigationApproval)
  ) {
    throw new DomainError("Invalid approval.", 400);
  }
  if (
    input.feedbackRating !== undefined &&
    !ratings.has(
      input.feedbackRating as NonNullable<AIInvestigation["feedbackRating"]>,
    )
  ) {
    throw new DomainError("Invalid rating.", 400);
  }
  if (
    input.feedbackNotes !== undefined &&
    typeof input.feedbackNotes !== "string"
  ) {
    throw new DomainError("Feedback notes must be text.", 400);
  }
}

export async function generateInvestigation(caseId: string, actor: Actor) {
  const paymentCase = await getCase(caseId, actor.organizationId);
  if (!paymentCase) throw new DomainError("Case not found.", 404);

  const result = await investigateCase(paymentCase);
  const investigationId = await saveInvestigation(
    caseId,
    result.analysis,
    result,
  );

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.id,
    actorName: actor.name,
    action: "investigation.generated",
    entityType: "ai_investigation",
    entityId: investigationId,
    details: {
      provider: result.provider,
      model: result.model,
      promptVersion: result.promptVersion,
      caseId,
    },
  });

  return getCase(caseId, actor.organizationId);
}

export async function reviewInvestigation(
  investigationId: string,
  patch: unknown,
  actor: Actor,
) {
  validateInvestigationReview(patch);
  const updated = await updateInvestigation(
    investigationId,
    actor.organizationId,
    {
      ...patch,
      feedbackNotes: patch.feedbackNotes?.trim(),
    },
  );
  if (!updated) throw new DomainError("Investigation not found.", 404);

  await recordAuditEvent({
    organizationId: actor.organizationId,
    actorUserId: actor.id,
    actorName: actor.name,
    action: "investigation.reviewed",
    entityType: "ai_investigation",
    entityId: investigationId,
    details: patch,
  });

  return updated;
}
