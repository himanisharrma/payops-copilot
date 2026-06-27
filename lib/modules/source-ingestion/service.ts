import { createHash } from "node:crypto";
import Papa from "papaparse";
import type { Actor } from "@/lib/access";
import { transaction } from "@/lib/db";
import { recordAuditEvent } from "@/lib/modules/audit/repository";
import { DomainError } from "@/lib/modules/errors";
import {
  findArrivalByHash,
  findLatestArrival,
  getArrivalForReview,
  getSourceIngestionVersion,
  getExpectationForUpload,
  insertArrival,
  insertSourceIngestionEvent,
  insertReadinessSnapshot,
  listReadinessSnapshots,
  listSourceIngestionWorkspace,
  lockSourceIngestion,
  reviewArrival,
  updateExpectationStatus,
  upsertExpectation,
  upsertSource,
} from "@/lib/modules/source-ingestion/repository";
import type {
  DownstreamWorkflow,
  SourceArrivalClassification,
  SourceIngestionProviderId,
  SourceIngestionWorkspace,
  SourceKind,
  SourceReadinessSummary,
  SourceTransportType,
  SourceValidationStatus,
} from "@/lib/modules/source-ingestion/types";

const providerIds = [
  "generic",
  "razorpay_demo",
  "cashfree_demo",
  "payu_demo",
  "paytm_demo",
  "bank_demo",
  "internal_ledger",
] as const;
const sourceKinds = [
  "internal_orders",
  "gateway_report",
  "settlement_statement",
  "bank_statement",
  "refunds_report",
  "chargebacks_report",
] as const;
const transportTypes = [
  "manual_upload",
  "email_demo",
  "sftp_demo",
  "dashboard_export_demo",
  "api_demo",
] as const;

const requiredHeaders: Record<SourceKind, string[]> = {
  internal_orders: ["order_id", "amount", "payment_mode"],
  gateway_report: ["order_id", "gateway_reference", "amount", "status"],
  settlement_statement: ["statement_reference", "order_id", "net_amount", "utr"],
  bank_statement: ["bank_reference", "utr", "amount", "credited_at"],
  refunds_report: ["order_id", "refund_amount", "refund_reference"],
  chargebacks_report: ["order_id", "chargeback_amount", "dispute_reference"],
};

export function parseSourceBusinessDate(params: URLSearchParams) {
  const value = params.get("businessDate");
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date().toISOString().slice(0, 10);
}

export async function loadSourceIngestionControlPlane(
  organizationId: string,
  params: URLSearchParams,
): Promise<SourceIngestionWorkspace> {
  const businessDate = parseSourceBusinessDate(params);
  const workspace = await listSourceIngestionWorkspace(organizationId, businessDate);
  return {
    ...workspace,
    summary: buildReadinessSummary(businessDate, workspace.expectations),
  };
}

export async function loadSourceIngestionVersion(
  arrivalId: string,
  organizationId: string,
) {
  return getSourceIngestionVersion(organizationId, arrivalId);
}

export async function decideSourceIngestionVersion(input: {
  actor: Actor;
  arrivalId: string;
  action: "accept" | "reject";
  reason: string;
}) {
  if (input.actor.role === "viewer") {
    throw new DomainError("Viewers cannot review source versions.", 403);
  }
  if (input.action !== "accept" && input.action !== "reject") {
    throw new DomainError("Action must be accept or reject.", 400);
  }
  const reason = clean(input.reason);
  if (reason.length < 3 || reason.length > 1000) {
    throw new DomainError("Review reason must be between 3 and 1000 characters.", 400);
  }
  return transaction(async (client) => {
    await lockSourceIngestion(client, input.actor.organizationId);
    const current = await getArrivalForReview(
      client, input.actor.organizationId, input.arrivalId,
    );
    if (!current) throw new DomainError("Source version not found.", 404);
    if (current.validationStatus === "accepted") {
      throw new DomainError("Accepted source versions are immutable.", 409);
    }
    if (current.validationStatus !== "needs_review") {
      throw new DomainError("This source version is no longer awaiting review.", 409);
    }
    const status = input.action === "accept" ? "accepted" : "rejected";
    const arrival = await reviewArrival(client, {
      organizationId: input.actor.organizationId,
      arrivalId: input.arrivalId,
      status,
      actorUserId: input.actor.id,
      actorName: input.actor.name,
      reason,
    });
    if (!arrival) throw new DomainError("Source version review conflicted.", 409);
    await insertSourceIngestionEvent(client, {
      organizationId: input.actor.organizationId,
      sourceId: arrival.sourceId,
      expectationId: arrival.expectationId,
      arrivalId: arrival.id,
      actorUserId: input.actor.id,
      actorName: input.actor.name,
      eventType: input.action === "accept" ? "file_accepted" : "file_rejected",
      details: { previousStatus: current.validationStatus, validationStatus: status, reason },
    });
    await recordAuditEvent({
      organizationId: input.actor.organizationId,
      actorUserId: input.actor.id,
      actorName: input.actor.name,
      action: `source_ingestion.file_${status}`,
      entityType: "source_ingestion_arrival",
      entityId: arrival.id,
      details: { previousStatus: current.validationStatus, reason },
    }, client);
    return arrival;
  });
}

export async function persistSourceReadinessSnapshot(input: {
  actor: Actor;
  businessDate: string;
}) {
  if (input.actor.role === "viewer") {
    throw new DomainError("Viewers cannot persist readiness snapshots.", 403);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.businessDate)) {
    throw new DomainError("Business date must be YYYY-MM-DD.", 400);
  }
  return transaction(async (client) => {
    await lockSourceIngestion(client, input.actor.organizationId);
    const workspace = await listSourceIngestionWorkspace(
      input.actor.organizationId, input.businessDate,
    );
    const summary = buildReadinessSummary(input.businessDate, workspace.expectations);
    const blockingExpectationIds = workspace.expectations
      .filter((item) => item.requiredForClose && item.status !== "waived"
        && !item.arrivals.some((arrival) => arrival.validationStatus === "accepted"))
      .map((item) => item.id);
    const snapshot = await insertReadinessSnapshot(client, {
      organizationId: input.actor.organizationId,
      summary,
      blockingExpectationIds,
      actorUserId: input.actor.id,
      actorName: input.actor.name,
    });
    await insertSourceIngestionEvent(client, {
      organizationId: input.actor.organizationId,
      actorUserId: input.actor.id,
      actorName: input.actor.name,
      eventType: "readiness_snapshotted",
      details: { snapshotId: snapshot.id, businessDate: input.businessDate, verdict: snapshot.verdict },
    });
    await recordAuditEvent({
      organizationId: input.actor.organizationId,
      actorUserId: input.actor.id,
      actorName: input.actor.name,
      action: "source_ingestion.readiness_snapshotted",
      entityType: "source_ingestion_readiness_snapshot",
      entityId: snapshot.id,
      details: { businessDate: input.businessDate, verdict: snapshot.verdict, blockingExpectationIds },
    }, client);
    return snapshot;
  });
}

export async function loadSourceReadinessSnapshots(
  organizationId: string, params: URLSearchParams,
) {
  return listReadinessSnapshots(organizationId, parseSourceBusinessDate(params));
}

export async function registerSourceExpectation(input: {
  actor: Actor;
  sourceKey: string;
  displayName: string;
  providerId: SourceIngestionProviderId;
  sourceKind: SourceKind;
  transportType: SourceTransportType;
  businessDate: string;
  expectedArrivalAt: string;
  graceMinutes: number;
  requiredForClose: boolean;
  expectedFilenamePattern: string;
  ownerTeam: string;
  seedMarker?: string | null;
}) {
  validateEnum(input.providerId, providerIds, "provider");
  validateEnum(input.sourceKind, sourceKinds, "source kind");
  validateEnum(input.transportType, transportTypes, "transport type");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.businessDate)) {
    throw new DomainError("Business date must be YYYY-MM-DD.", 400);
  }
  return transaction(async (client) => {
    await lockSourceIngestion(client, input.actor.organizationId);
    const sourceId = await upsertSource(client, {
      organizationId: input.actor.organizationId,
      sourceKey: clean(input.sourceKey),
      displayName: clean(input.displayName),
      providerId: input.providerId,
      sourceKind: input.sourceKind,
      transportType: input.transportType,
      expectedFrequency: "daily",
      ownerTeam: clean(input.ownerTeam),
      evidence: { synthetic: true, controlPlane: "source-ingestion-v1" },
      seedMarker: input.seedMarker,
    });
    const expectationId = await upsertExpectation(client, {
      organizationId: input.actor.organizationId,
      sourceId,
      businessDate: input.businessDate,
      expectedArrivalAt: input.expectedArrivalAt,
      graceMinutes: Math.max(0, Math.min(2880, Math.trunc(input.graceMinutes))),
      requiredForClose: input.requiredForClose,
      expectedFilenamePattern: clean(input.expectedFilenamePattern),
      status: "expected",
      seedMarker: input.seedMarker,
    });
    await insertSourceIngestionEvent(client, {
      organizationId: input.actor.organizationId,
      sourceId,
      expectationId,
      actorUserId: input.actor.id,
      actorName: input.actor.name,
      eventType: "expectation_scheduled",
      details: { businessDate: input.businessDate, seedMarker: input.seedMarker },
    });
    await recordAuditEvent(
      {
        organizationId: input.actor.organizationId,
        actorUserId: input.actor.id,
        actorName: input.actor.name,
        action: "source_ingestion.expectation_scheduled",
        entityType: "source_ingestion_expectation",
        entityId: expectationId,
        details: { sourceKey: input.sourceKey, businessDate: input.businessDate },
      },
      client,
    );
    return { sourceId, expectationId };
  });
}

export async function uploadSourceFile(input: {
  actor: Actor;
  expectationId: string;
  filename: string;
  csvText: string;
  receivedAt?: string;
  seedMarker?: string | null;
}) {
  const fileHash = sha256(input.csvText);
  const receivedAt = input.receivedAt ?? new Date().toISOString();
  return transaction(async (client) => {
    await lockSourceIngestion(client, input.actor.organizationId);
    const expectation = await getExpectationForUpload(
      client,
      input.actor.organizationId,
      input.expectationId,
    );
    if (!expectation) throw new DomainError("Source expectation not found.", 404);

    const profile = profileSourceCsv(input.csvText, expectation.sourceKind);
    const duplicateArrivalId = await findArrivalByHash(
      client,
      input.actor.organizationId,
      expectation.sourceId,
      fileHash,
    );
    const latestArrival = await findLatestArrival(
      client,
      input.actor.organizationId,
      expectation.id,
    );
    const classification = classifyArrival({
      duplicateArrivalId,
      latestAcceptedHash: latestArrival?.file_hash ?? null,
      sourceRowCount: profile.rowCount,
      missingHeaders: profile.missingHeaders,
      receivedAt,
      expectedArrivalAt: expectation.expectedArrivalAt,
      graceMinutes: expectation.graceMinutes,
    });
    const validationStatus = validationStatusFor(classification);
    const acceptedRows = validationStatus === "accepted" ? profile.rowCount : 0;
    const arrivalId = await insertArrival(client, {
      organizationId: input.actor.organizationId,
      expectationId: expectation.id,
      sourceId: expectation.sourceId,
      fileName: clean(input.filename).slice(0, 240),
      fileHash,
      sourceRowCount: profile.rowCount,
      acceptedRowCount: acceptedRows,
      rejectedRowCount: profile.rowCount - acceptedRows,
      receivedAt,
      supersedesArrivalId:
        classification === "revised" ? latestArrival?.id ?? null : null,
      classification,
      validationStatus,
      downstreamWorkflow: workflowFor(expectation.sourceKind, validationStatus),
      evidence: {
        synthetic: true,
        profileVersion: "source-profile-v1",
        headers: profile.headers,
        missingHeaders: profile.missingHeaders,
        amountTotals: profile.amountTotals,
        dateRange: profile.dateRange,
        diagnostics: profile.diagnostics,
        duplicateArrivalId,
      },
      seedMarker: input.seedMarker,
    });
    await updateExpectationStatus(
      client,
      input.actor.organizationId,
      expectation.id,
      classification === "late" ? "late" : "arrived",
    );
    await insertSourceIngestionEvent(client, {
      organizationId: input.actor.organizationId,
      sourceId: expectation.sourceId,
      expectationId: expectation.id,
      arrivalId,
      actorUserId: input.actor.id,
      actorName: input.actor.name,
      eventType: validationStatus === "rejected" ? "file_rejected" : "file_arrived",
      details: {
        classification,
        validationStatus,
        fileHash,
        rowCount: profile.rowCount,
        seedMarker: input.seedMarker,
      },
    });
    await recordAuditEvent(
      {
        organizationId: input.actor.organizationId,
        actorUserId: input.actor.id,
        actorName: input.actor.name,
        action: "source_ingestion.file_arrived",
        entityType: "source_ingestion_arrival",
        entityId: arrivalId,
        details: { expectationId: expectation.id, classification, fileHash },
      },
      client,
    );
    return { arrivalId, classification, validationStatus, fileHash, profile };
  });
}

export function profileSourceCsv(csvText: string, sourceKind: SourceKind) {
  const parsed = Papa.parse<Record<string, string>>(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
  });
  const rows = parsed.data.filter((row) =>
    Object.values(row).some((value) => String(value ?? "").trim()),
  );
  const headers = normalizeHeaders(parsed.meta.fields ?? []);
  const missingHeaders = requiredHeaders[sourceKind].filter(
    (field) => !headers.includes(field),
  );
  const diagnostics = [
    ...missingHeaders.map((field) => ({
      severity: "error" as const,
      code: "missing_required_column",
      message: `Missing required column: ${field}`,
    })),
  ];
  const amountTotals: Record<string, number> = {};
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      const normalized = normalizeHeader(key);
      if (!normalized.includes("amount") && !normalized.includes("net")) continue;
      const numeric = Number(String(value ?? "").replace(/,/g, ""));
      if (Number.isFinite(numeric)) {
        amountTotals[normalized] = roundMoney((amountTotals[normalized] ?? 0) + numeric);
      }
    }
  }
  return {
    rowCount: rows.length,
    headers,
    missingHeaders,
    amountTotals,
    dateRange: inferDateRange(rows),
    diagnostics:
      rows.length === 0
        ? [
            ...diagnostics,
            {
              severity: "error" as const,
              code: "empty_file",
              message: "CSV contained no data rows.",
            },
          ]
        : diagnostics,
  };
}

export function classifyArrival(input: {
  duplicateArrivalId: string | null;
  latestAcceptedHash: string | null;
  sourceRowCount: number;
  missingHeaders: string[];
  receivedAt: string;
  expectedArrivalAt: string;
  graceMinutes: number;
}): SourceArrivalClassification {
  if (input.duplicateArrivalId) return "duplicate";
  if (input.sourceRowCount === 0) return "empty_file";
  if (input.missingHeaders.length > 0) return "schema_failed";
  if (input.sourceRowCount < 2) return "partial";
  if (input.latestAcceptedHash && input.latestAcceptedHash !== "") return "revised";
  const arrived = new Date(input.receivedAt).getTime();
  const due =
    new Date(input.expectedArrivalAt).getTime() + input.graceMinutes * 60_000;
  return arrived > due ? "late" : "on_time";
}

export function buildReadinessSummary(
  businessDate: string,
  expectations: SourceIngestionWorkspace["expectations"],
): SourceReadinessSummary {
  const hasAcceptedVersion = (item: SourceIngestionWorkspace["expectations"][number]) =>
    (item.arrivals ?? (item.latestArrival ? [item.latestArrival] : []))
      .some((arrival) => arrival.validationStatus === "accepted");
  const acceptedFiles = expectations.filter(
    hasAcceptedVersion,
  ).length;
  const missingFiles = expectations.filter((item) => !item.latestArrival).length;
  const lateFiles = expectations.filter(
    (item) => item.status === "late" || item.latestArrival?.classification === "late",
  ).length;
  const quarantinedFiles = expectations.filter(
    (item) => item.latestArrival?.validationStatus === "needs_review",
  ).length;
  const blockingFiles = expectations.filter(
    (item) =>
      item.requiredForClose &&
      item.status !== "waived" &&
      !hasAcceptedVersion(item),
  ).length;
  return {
    businessDate,
    verdict: blockingFiles === 0 ? "ready" : "blocked",
    expectedFiles: expectations.length,
    acceptedFiles,
    missingFiles,
    lateFiles,
    quarantinedFiles,
    blockingFiles,
    optionalWarnings: expectations.filter(
      (item) => !item.requiredForClose &&
        !hasAcceptedVersion(item),
    ).length,
  };
}

function validationStatusFor(
  classification: SourceArrivalClassification,
): SourceValidationStatus {
  if (classification === "duplicate") return "rejected";
  if (["schema_failed", "empty_file", "partial", "hash_mismatch"].includes(classification)) {
    return "needs_review";
  }
  return "accepted";
}

function workflowFor(
  sourceKind: SourceKind,
  validationStatus: SourceValidationStatus,
): DownstreamWorkflow {
  if (validationStatus !== "accepted") return "manual_review";
  if (sourceKind === "settlement_statement") return "settlement_import";
  if (sourceKind === "bank_statement") return "close_control";
  return "reconciliation";
}

function validateEnum<T extends string>(
  value: string,
  allowed: readonly T[],
  label: string,
): asserts value is T {
  if (!allowed.includes(value as T)) {
    throw new DomainError(`Unsupported ${label}.`, 400);
  }
}

function inferDateRange(rows: Array<Record<string, string>>) {
  const dates = rows
    .flatMap((row) =>
      Object.entries(row)
        .filter(([key]) => normalizeHeader(key).includes("date"))
        .map(([, value]) => new Date(value).getTime()),
    )
    .filter(Number.isFinite)
    .sort();
  return {
    min: dates[0] ? new Date(dates[0]).toISOString().slice(0, 10) : null,
    max: dates.at(-1) ? new Date(dates.at(-1) as number).toISOString().slice(0, 10) : null,
  };
}

function normalizeHeaders(headers: string[]) {
  return headers.map(normalizeHeader);
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function clean(value: string) {
  return value.trim().replace(/\s+/g, " ");
}
