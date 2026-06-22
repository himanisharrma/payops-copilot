import type { Actor } from "@/lib/access";
import { parseCloseFilters, stableSnapshotHash } from "@/lib/close-control";
import { transaction } from "@/lib/db";
import { recordAuditEvent } from "@/lib/modules/audit/repository";
import {
  approveClosePeriod,
  createCloseVersion,
  getCloseOptions,
  getClosePeriodById,
  getClosePeriodByScope,
  getCloseReadiness,
  getOrCreateClosePeriod,
  listClosePeriods,
  reopenClosePeriod,
} from "@/lib/modules/close-control/repository";
import { DomainError } from "@/lib/modules/errors";
import type {
  ReconciliationClosePeriod,
  ReconciliationCloseWorkspace,
} from "@/lib/types";

type SubmitCloseInput = {
  businessDate: string;
  providerId: string;
  paymentMode: string;
  unresolvedCountThreshold: number;
  unresolvedAmountThreshold: number;
  dispositions: Array<{
    caseId: string;
    reason: string;
    evidenceConfirmed: boolean;
  }>;
};

export async function loadCloseWorkspace(
  organizationId: string,
  params: URLSearchParams,
): Promise<ReconciliationCloseWorkspace> {
  const scope = parseCloseFilters(params);
  const existing = await getClosePeriodByScope(organizationId, scope);
  const thresholds = existing
    ? {
        unresolvedCountThreshold: existing.unresolvedCountThreshold,
        unresolvedAmountThreshold: existing.unresolvedAmountThreshold,
      }
    : {
        unresolvedCountThreshold: 0,
        unresolvedAmountThreshold: 0,
      };
  const readiness = await getCloseReadiness(
    organizationId,
    scope,
    thresholds,
  );
  const historyRows = await listClosePeriods(organizationId);
  return {
    selected: {
      ...(existing ?? emptyPeriod(scope)),
      readiness,
    },
    options: await getCloseOptions(organizationId),
    history: historyRows.map((period) => ({
      ...period,
      readiness:
        period.activeVersion?.snapshot ??
        emptyReadiness(period),
    })),
  };
}

export async function submitCloseControl(
  input: unknown,
  actor: Actor,
) {
  const value = validateSubmit(input);
  const scope = parseCloseFilters(
    new URLSearchParams({
      date: value.businessDate,
      provider: value.providerId,
      paymentMode: value.paymentMode,
    }),
  );
  if (
    scope.businessDate !== value.businessDate ||
    scope.providerId !== value.providerId ||
    scope.paymentMode !== value.paymentMode.trim()
  ) {
    throw new DomainError("Close scope is invalid.", 400);
  }
  return transaction(async (client) => {
    const readiness = await getCloseReadiness(
      actor.organizationId,
      scope,
      {
        unresolvedCountThreshold: value.unresolvedCountThreshold,
        unresolvedAmountThreshold: value.unresolvedAmountThreshold,
      },
      client,
    );
    if (!readiness.ready) {
      throw new DomainError(readiness.blockers.join(" "), 409);
    }
    validateDispositions(readiness.unresolvedCases.map((item) => item.id), value);
    const periodId = await getOrCreateClosePeriod(
      client,
      actor.organizationId,
      scope,
      {
        unresolvedCountThreshold: value.unresolvedCountThreshold,
        unresolvedAmountThreshold: value.unresolvedAmountThreshold,
      },
    );
    const existing = await getClosePeriodById(
      periodId,
      actor.organizationId,
      client,
    );
    if (existing?.status === "submitted") {
      throw new DomainError(
        "This close is already awaiting approval.",
        409,
      );
    }
    if (existing?.status === "approved") {
      throw new DomainError(
        "Reopen the approved close before submitting a new version.",
        409,
      );
    }
    const snapshot = {
      ...readiness,
      unresolvedCases: readiness.unresolvedCases.map((paymentCase) => ({
        ...paymentCase,
      })),
    };
    const version = await createCloseVersion(client, {
      organizationId: actor.organizationId,
      periodId,
      snapshot,
      snapshotHash: stableSnapshotHash({
        snapshot,
        dispositions: [...value.dispositions].sort((left, right) =>
          left.caseId.localeCompare(right.caseId),
        ),
      }),
      preparedByUserId: actor.id,
      preparedByName: actor.name,
      dispositions: value.dispositions.map((item) => ({
        ...item,
        reason: item.reason.trim(),
      })),
    });
    await recordAuditEvent(
      {
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        actorName: actor.name,
        action: "reconciliation_close.submitted",
        entityType: "reconciliation_close_period",
        entityId: periodId,
        details: {
          businessDate: scope.businessDate,
          providerId: scope.providerId,
          paymentMode: scope.paymentMode,
          versionNumber: version.version_number,
          snapshotHash: stableSnapshotHash({
            snapshot,
            dispositions: [...value.dispositions].sort((left, right) =>
              left.caseId.localeCompare(right.caseId),
            ),
          }),
          unresolvedCaseCount: readiness.unresolvedCaseCount,
          unresolvedExposure: readiness.unresolvedExposure,
        },
      },
      client,
    );
    return getClosePeriodById(periodId, actor.organizationId, client);
  });
}

export async function changeCloseControl(
  id: string,
  input: unknown,
  actor: Actor,
) {
  const action = validateAction(input);
  return transaction(async (client) => {
    const existing = await getClosePeriodById(
      id,
      actor.organizationId,
      client,
    );
    if (!existing) throw new DomainError("Close period not found.", 404);
    if (action.action === "approve") {
      if (actor.role !== "admin") {
        throw new DomainError(
          "Only an administrator may approve a reconciliation close.",
          403,
        );
      }
      const result = await approveClosePeriod(client, {
        periodId: id,
        organizationId: actor.organizationId,
        approverUserId: actor.id,
        approverName: actor.name,
      });
      if (!result) {
        throw new DomainError(
          "Only a submitted close may be approved.",
          409,
        );
      }
      if (result.makerConflict) {
        throw new DomainError(
          "The preparer cannot approve the same close.",
          409,
        );
      }
      await recordAuditEvent(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          actorName: actor.name,
          action: "reconciliation_close.approved",
          entityType: "reconciliation_close_period",
          entityId: id,
          details: {
            snapshotHash: existing.activeVersion?.snapshotHash,
            preparedByName: existing.activeVersion?.preparedByName,
          },
        },
        client,
      );
    } else {
      if (actor.role !== "admin") {
        throw new DomainError(
          "Only an administrator may reopen a reconciliation close.",
          403,
        );
      }
      const reopened = await reopenClosePeriod(client, {
        periodId: id,
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        actorName: actor.name,
        reason: action.reason,
      });
      if (!reopened) {
        throw new DomainError(
          "Only an approved close may be reopened.",
          409,
        );
      }
      await recordAuditEvent(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          actorName: actor.name,
          action: "reconciliation_close.reopened",
          entityType: "reconciliation_close_period",
          entityId: id,
          details: {
            reason: action.reason,
            priorSnapshotHash: existing.activeVersion?.snapshotHash,
          },
        },
        client,
      );
    }
    return getClosePeriodById(id, actor.organizationId, client);
  });
}

export async function getCloseCertificate(id: string, actor: Actor) {
  const period = await getClosePeriodById(id, actor.organizationId);
  if (!period) throw new DomainError("Close period not found.", 404);
  if (period.status !== "approved" || !period.activeVersion?.approvedAt) {
    throw new DomainError(
      "A certificate is available only after approval.",
      409,
    );
  }
  return {
    certificateType: "synthetic_reconciliation_close",
    organizationName: actor.organizationName,
    generatedAt: new Date().toISOString(),
    period,
    boundary:
      "Portfolio evidence only. This certificate does not represent a bank or provider attestation.",
  };
}

function validateSubmit(input: unknown): SubmitCloseInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new DomainError("Close submission must be an object.", 400);
  }
  const value = input as Partial<SubmitCloseInput>;
  if (
    typeof value.businessDate !== "string" ||
    typeof value.providerId !== "string" ||
    typeof value.paymentMode !== "string" ||
    !value.paymentMode.trim()
  ) {
    throw new DomainError("Close scope is required.", 400);
  }
  if (
    !Number.isInteger(value.unresolvedCountThreshold) ||
    value.unresolvedCountThreshold! < 0 ||
    value.unresolvedCountThreshold! > 10000
  ) {
    throw new DomainError("Case threshold must be between 0 and 10,000.", 400);
  }
  if (
    typeof value.unresolvedAmountThreshold !== "number" ||
    !Number.isFinite(value.unresolvedAmountThreshold) ||
    value.unresolvedAmountThreshold < 0
  ) {
    throw new DomainError("Amount threshold must be zero or greater.", 400);
  }
  if (!Array.isArray(value.dispositions)) {
    throw new DomainError("Exception dispositions are required.", 400);
  }
  return value as SubmitCloseInput;
}

function validateDispositions(caseIds: string[], input: SubmitCloseInput) {
  const expected = new Set(caseIds);
  const supplied = new Set<string>();
  for (const item of input.dispositions) {
    if (
      !item ||
      typeof item.caseId !== "string" ||
      !expected.has(item.caseId) ||
      supplied.has(item.caseId) ||
      typeof item.reason !== "string" ||
      item.reason.trim().length < 10 ||
      item.reason.trim().length > 2000 ||
      item.evidenceConfirmed !== true
    ) {
      throw new DomainError(
        "Every unresolved exception needs one evidence-confirmed disposition of at least 10 characters.",
        400,
      );
    }
    supplied.add(item.caseId);
  }
  if (supplied.size !== expected.size) {
    throw new DomainError(
      "Disposition every unresolved exception before submission.",
      400,
    );
  }
}

function validateAction(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new DomainError("Close action must be an object.", 400);
  }
  const value = input as { action?: unknown; reason?: unknown };
  if (value.action === "approve") return { action: "approve" as const };
  if (
    value.action === "reopen" &&
    typeof value.reason === "string" &&
    value.reason.trim().length >= 10 &&
    value.reason.trim().length <= 2000
  ) {
    return { action: "reopen" as const, reason: value.reason.trim() };
  }
  throw new DomainError(
    "Reopening requires a reason of at least 10 characters.",
    400,
  );
}

function emptyPeriod(scope: {
  businessDate: string;
  providerId: ReconciliationClosePeriod["providerId"];
  paymentMode: string;
}): Omit<ReconciliationClosePeriod, "readiness"> {
  return {
    id: null,
    ...scope,
    status: "open",
    unresolvedCountThreshold: 0,
    unresolvedAmountThreshold: 0,
    reopenedByName: null,
    reopenedReason: null,
    reopenedAt: null,
    activeVersion: null,
  };
}

function emptyReadiness(
  period: Omit<ReconciliationClosePeriod, "readiness">,
): ReconciliationClosePeriod["readiness"] {
  return {
    businessDate: period.businessDate,
    providerId: period.providerId,
    paymentMode: period.paymentMode,
    runCount: 0,
    itemCount: 0,
    processedValue: 0,
    matchedValue: 0,
    actionableExceptionCount: 0,
    unresolvedCaseCount: 0,
    unresolvedExposure: 0,
    blockingCaseCount: 0,
    unresolvedCountThreshold: period.unresolvedCountThreshold,
    unresolvedAmountThreshold: period.unresolvedAmountThreshold,
    ready: false,
    blockers: [],
    unresolvedCases: [],
  };
}
