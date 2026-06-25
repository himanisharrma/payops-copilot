import type { Actor } from "@/lib/access";
import { transaction } from "@/lib/db";
import { recordAuditEvent } from "@/lib/modules/audit/repository";
import { DomainError } from "@/lib/modules/errors";
import {
  createRemediationProgram,
  finalizeRemediationProgram,
  getEligibleOwner,
  getRemediationProgram,
  listRecurrenceSuggestions,
  listRemediationOwners,
  listRemediationPrograms,
  type RemediationFilters,
  updateRemediationProgram,
} from "@/lib/modules/remediation-programs/repository";
import { providerIds } from "@/lib/provider-adapters";
import type {
  ProviderId,
  RemediationProgramsWorkspace,
  RemediationProgramStatus,
} from "@/lib/types";

const programStatuses: Array<RemediationProgramStatus | "all"> = [
  "all",
  "active",
  "monitoring",
  "verified",
  "abandoned",
];

export function parseRemediationFilters(
  params: URLSearchParams,
): RemediationFilters {
  const provider = params.get("provider");
  const status = params.get("status");
  return {
    provider:
      provider === "all" || providerIds.includes(provider as ProviderId)
        ? ((provider ?? "all") as RemediationFilters["provider"])
        : "all",
    paymentMode: params.get("paymentMode")?.trim() || "all",
    status: programStatuses.includes(
      status as RemediationProgramStatus | "all",
    )
      ? (status as RemediationFilters["status"])
      : "all",
  };
}

export async function loadRemediationWorkspace(
  organizationId: string,
  params: URLSearchParams,
): Promise<RemediationProgramsWorkspace> {
  const filters = parseRemediationFilters(params);
  const [suggestions, programs, owners] = await Promise.all([
    listRecurrenceSuggestions(organizationId, filters),
    listRemediationPrograms(organizationId, filters),
    listRemediationOwners(organizationId),
  ]);
  const paymentModes = [
    ...new Set([
      ...suggestions.map((item) => item.paymentMode),
      ...programs.map((item) => item.paymentMode),
    ]),
  ].sort();
  return {
    summary: {
      suggestedClusters: suggestions.filter((item) => !item.promoted).length,
      recurringExposure: suggestions.reduce(
        (total, item) => total + item.exposure,
        0,
      ),
      openPrograms: programs.filter((item) =>
        ["active", "monitoring"].includes(item.status),
      ).length,
      verifiedPrograms: programs.filter(
        (item) => item.status === "verified",
      ).length,
    },
    filters,
    options: {
      providers: [...providerIds],
      paymentModes,
      owners,
    },
    suggestions,
    programs,
  };
}

export async function promoteRecurrenceSuggestion(
  input: unknown,
  actor: Actor,
) {
  const value = validateCreate(input);
  return transaction(async (client) => {
    const suggestion = (
      await listRecurrenceSuggestions(
        actor.organizationId,
        {
          provider: "all",
          paymentMode: "all",
          status: "all",
        },
        client,
      )
    ).find((item) => item.fingerprint === value.fingerprint);
    if (!suggestion) {
      throw new DomainError(
        "This recurrence no longer meets the three-case, 30-day threshold.",
        409,
      );
    }
    if (suggestion.promoted) {
      throw new DomainError(
        "An active remediation program already owns this recurrence.",
        409,
      );
    }
    const owner = await getEligibleOwner(
      value.ownerUserId,
      actor.organizationId,
      client,
    );
    if (!owner) {
      throw new DomainError(
        "Select an active administrator or analyst as owner.",
        400,
      );
    }
    let programId: string;
    try {
      programId = await createRemediationProgram(client, {
        organizationId: actor.organizationId,
        suggestion,
        ownerUserId: owner.id,
        ownerName: owner.name,
        remediationPlan: value.remediationPlan,
        targetDate: value.targetDate,
        createdByUserId: actor.id,
        createdByName: actor.name,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "23505"
      ) {
        throw new DomainError(
          "An active remediation program already owns this recurrence.",
          409,
        );
      }
      throw error;
    }
    await recordAuditEvent(
      {
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        actorName: actor.name,
        action: "remediation_program.created",
        entityType: "remediation_program",
        entityId: programId,
        details: {
          fingerprint: suggestion.fingerprint,
          caseCount: suggestion.caseCount,
          exposure: suggestion.exposure,
          ownerName: owner.name,
          targetDate: value.targetDate,
        },
      },
      client,
    );
    return getRemediationProgram(
      programId,
      actor.organizationId,
      client,
    );
  });
}

export async function changeRemediationProgram(
  id: string,
  input: unknown,
  actor: Actor,
) {
  const value = validatePatch(input);
  return transaction(async (client) => {
    const existing = await getRemediationProgram(
      id,
      actor.organizationId,
      client,
    );
    if (!existing) {
      throw new DomainError("Remediation program not found.", 404);
    }
    if (value.action === "verify" || value.action === "abandon") {
      if (actor.role !== "admin") {
        throw new DomainError(
          "Only an administrator may verify or abandon a remediation program.",
          403,
        );
      }
      if (value.action === "verify") {
        if (existing.status !== "monitoring") {
          throw new DomainError(
            "Only a monitoring program may be verified.",
            409,
          );
        }
        const lastTwo = existing.cleanRuns.slice(-2);
        if (
          lastTwo.length < 2 ||
          lastTwo.some((run) => !run.clean)
        ) {
          throw new DomainError(
            "Verification requires the two latest qualifying runs to contain zero matching recurrence.",
            409,
          );
        }
      }
      const finalized = await finalizeRemediationProgram(client, {
        id,
        organizationId: actor.organizationId,
        action: value.action,
        reason: value.reason,
        actorUserId: actor.id,
        actorName: actor.name,
      });
      if (!finalized) {
        throw new DomainError(
          "The program is not eligible for this transition.",
          409,
        );
      }
      await recordAuditEvent(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          actorName: actor.name,
          action:
            value.action === "verify"
              ? "remediation_program.verified"
              : "remediation_program.abandoned",
          entityType: "remediation_program",
          entityId: id,
          details:
            value.action === "verify"
              ? {
                  cleanRunIds: existing.cleanRuns
                    .slice(-2)
                    .map((run) => run.runId),
                }
              : { reason: value.reason },
        },
        client,
      );
    } else {
      const owner = value.ownerUserId
        ? await getEligibleOwner(
            value.ownerUserId,
            actor.organizationId,
            client,
          )
        : null;
      if (value.ownerUserId && !owner) {
        throw new DomainError(
          "Select an active administrator or analyst as owner.",
          400,
        );
      }
      const updated = await updateRemediationProgram(client, {
        id,
        organizationId: actor.organizationId,
        ownerUserId: owner?.id,
        ownerName: owner?.name,
        remediationPlan: value.remediationPlan,
        targetDate: value.targetDate,
        implementationSummary: value.implementationSummary,
        implementationEvidenceReference:
          value.implementationEvidenceReference,
        actorUserId: actor.id,
        actorName: actor.name,
      });
      if (!updated) {
        throw new DomainError(
          "Only active or monitoring programs may be updated.",
          409,
        );
      }
      await recordAuditEvent(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          actorName: actor.name,
          action: value.implementationSummary
            ? "remediation_program.monitoring_started"
            : "remediation_program.updated",
          entityType: "remediation_program",
          entityId: id,
          details: {
            ownerName: owner?.name,
            targetDate: value.targetDate,
            planUpdated: Boolean(value.remediationPlan),
            implementationEvidenceReference:
              value.implementationEvidenceReference,
          },
        },
        client,
      );
    }
    return getRemediationProgram(id, actor.organizationId, client);
  });
}

function validateCreate(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new DomainError("Program creation must be an object.", 400);
  }
  const value = input as Record<string, unknown>;
  if (
    typeof value.fingerprint !== "string" ||
    !value.fingerprint.trim() ||
    typeof value.ownerUserId !== "string" ||
    typeof value.remediationPlan !== "string" ||
    value.remediationPlan.trim().length < 20 ||
    value.remediationPlan.trim().length > 4000 ||
    typeof value.targetDate !== "string" ||
    !validDate(value.targetDate)
  ) {
    throw new DomainError(
      "Fingerprint, eligible owner, target date, and a remediation plan of at least 20 characters are required.",
      400,
    );
  }
  return {
    fingerprint: value.fingerprint,
    ownerUserId: value.ownerUserId,
    remediationPlan: value.remediationPlan.trim(),
    targetDate: value.targetDate,
  };
}

function validatePatch(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new DomainError("Program update must be an object.", 400);
  }
  const value = input as Record<string, unknown>;
  if (value.action === "verify") {
    return { action: "verify" as const };
  }
  if (value.action === "abandon") {
    if (
      typeof value.reason !== "string" ||
      value.reason.trim().length < 10 ||
      value.reason.trim().length > 2000
    ) {
      throw new DomainError(
        "Abandoning a program requires a reason of at least 10 characters.",
        400,
      );
    }
    return { action: "abandon" as const, reason: value.reason.trim() };
  }
  const ownerUserId =
    typeof value.ownerUserId === "string" ? value.ownerUserId : undefined;
  const remediationPlan =
    typeof value.remediationPlan === "string"
      ? value.remediationPlan.trim()
      : undefined;
  const targetDate =
    typeof value.targetDate === "string" ? value.targetDate : undefined;
  const implementationSummary =
    typeof value.implementationSummary === "string"
      ? value.implementationSummary.trim()
      : undefined;
  const implementationEvidenceReference =
    typeof value.implementationEvidenceReference === "string"
      ? value.implementationEvidenceReference.trim()
      : undefined;
  if (
    remediationPlan !== undefined &&
    (remediationPlan.length < 20 || remediationPlan.length > 4000)
  ) {
    throw new DomainError(
      "The remediation plan must contain 20 to 4,000 characters.",
      400,
    );
  }
  if (targetDate !== undefined && !validDate(targetDate)) {
    throw new DomainError("Target date is invalid.", 400);
  }
  if (
    (implementationSummary === undefined) !==
    (implementationEvidenceReference === undefined)
  ) {
    throw new DomainError(
      "Implementation summary and evidence reference are required together.",
      400,
    );
  }
  if (
    implementationSummary !== undefined &&
    (implementationSummary.length < 20 ||
      implementationEvidenceReference!.length < 5)
  ) {
    throw new DomainError(
      "Implementation evidence requires a 20-character summary and a reference.",
      400,
    );
  }
  if (
    !ownerUserId &&
    !remediationPlan &&
    !targetDate &&
    !implementationSummary
  ) {
    throw new DomainError("No supported program change was supplied.", 400);
  }
  return {
    action: "update" as const,
    ownerUserId,
    remediationPlan,
    targetDate,
    implementationSummary,
    implementationEvidenceReference,
  };
}

function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
  );
}
