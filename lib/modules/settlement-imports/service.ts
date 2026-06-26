import { createHash } from "node:crypto";
import Papa from "papaparse";
import type { PoolClient } from "pg";
import type { Actor } from "@/lib/access";
import { transaction } from "@/lib/db";
import { DomainError } from "@/lib/modules/errors";
import { recordAuditEvent } from "@/lib/modules/audit/repository";
import {
  countDuplicateUtr,
  findLedgerMatch,
  getAdjustmentForUpdate,
  getExceptionForAdjustment,
  getImportDetail,
  getSettlementImportSummary,
  insertAdjustmentEvent,
  insertAdjustmentProposal,
  insertComparison,
  insertEvidencePacket,
  insertException,
  listSettlementImports,
  loadRowsForComparison,
  lockSettlementImport,
  replaceComparisons,
  replaceImportRows,
  updateAdjustmentStatus,
  updateImportStatus,
  upsertImportBatch,
} from "@/lib/modules/settlement-imports/repository";
import type {
  NormalizedSettlementImportRow,
  SettlementAdjustmentType,
  SettlementImportExceptionType,
  SettlementImportFilters,
} from "@/lib/modules/settlement-imports/types";
import { providerIds } from "@/lib/provider-adapters";
import type { ProviderId } from "@/lib/types";

const importStatuses = ["all", "staged", "compared", "needs_review", "closed"];
const exceptionTypes = [
  "all",
  "missing_utr",
  "utr_not_found",
  "duplicate_utr",
  "amount_mismatch",
  "failed_payout",
  "held_settlement",
  "delayed_credit",
  "retry_exhausted",
  "deduction_mismatch",
  "unexplained_hold",
  "forward_deduction_mismatch",
] as const;
const adjustmentStates = ["all", "none", "proposed", "approved", "rejected", "withdrawn"];
const linkedStates = ["all", "linked", "unlinked"];
const deductionTypes = [
  "mdr",
  "commission",
  "gst",
  "refund",
  "chargeback",
  "recovery",
  "adjustment",
  "rental",
  "subscription",
  "hold",
  "hold_release",
  "rounding",
];
const settlementStatuses = [
  "expected",
  "scheduled",
  "sent",
  "credited",
  "held",
  "failed",
  "partially_credited",
] as const;

export function parseSettlementImportFilters(
  params: URLSearchParams,
): SettlementImportFilters {
  const provider = params.get("provider");
  const status = params.get("status");
  const exceptionType = params.get("exceptionType");
  const adjustmentState = params.get("adjustmentState");
  const linkedCase = params.get("linkedCase");
  return {
    provider:
      provider === "all" || providerIds.includes(provider as ProviderId)
        ? ((provider ?? "all") as SettlementImportFilters["provider"])
        : "all",
    status: importStatuses.includes(status ?? "")
      ? (status as SettlementImportFilters["status"])
      : "all",
    exceptionType: exceptionTypes.includes(
      exceptionType as (typeof exceptionTypes)[number],
    )
      ? (exceptionType as SettlementImportFilters["exceptionType"])
      : "all",
    adjustmentState: adjustmentStates.includes(adjustmentState ?? "")
      ? (adjustmentState as SettlementImportFilters["adjustmentState"])
      : "all",
    linkedCase: linkedStates.includes(linkedCase ?? "")
      ? (linkedCase as SettlementImportFilters["linkedCase"])
      : "all",
  };
}

export async function loadSettlementImportWorkspace(
  organizationId: string,
  params: URLSearchParams,
) {
  const filters = parseSettlementImportFilters(params);
  const [{ imports, latestExceptions }, summary] = await Promise.all([
    listSettlementImports(organizationId, filters),
    getSettlementImportSummary(organizationId),
  ]);
  return { filters, summary, imports, latestExceptions };
}

export { getImportDetail as getSettlementImportDetail };

export async function createSettlementImport(input: {
  actor: Actor;
  providerId: ProviderId;
  filename: string;
  csvText: string;
  seedMarker?: string | null;
}) {
  if (!providerIds.includes(input.providerId)) {
    throw new DomainError("Unsupported provider adapter.", 400);
  }
  const sourceHash = sha256(input.csvText);
  const normalizedRows = parseSettlementImportCsv(input.csvText);
  const reference = `IMP-${input.providerId}-${sourceHash.slice(0, 10)}`;
  return transaction(async (client) => {
    await lockSettlementImport(client, input.actor.organizationId);
    const importBatchId = await upsertImportBatch(client, {
      organizationId: input.actor.organizationId,
      providerId: input.providerId,
      importReference: reference,
      sourceFilename: sanitizeFilename(input.filename),
      sourceHash,
      rowCount: normalizedRows.length,
      evidence: {
        source: "synthetic statement import",
        rowCount: normalizedRows.length,
        fictional: true,
      },
      seedMarker: input.seedMarker,
      importedByUserId: input.actor.id,
      importedByName: input.actor.name,
    });
    await replaceImportRows(
      client,
      input.actor.organizationId,
      importBatchId,
      normalizedRows,
    );
    const result = await compareSettlementImport(
      input.actor,
      importBatchId,
      client,
    );
    await recordAuditEvent(
      {
        organizationId: input.actor.organizationId,
        actorUserId: input.actor.id,
        actorName: input.actor.name,
        action: "settlement_import.created",
        entityType: "settlement_import",
        entityId: importBatchId,
        details: {
          providerId: input.providerId,
          rowCount: normalizedRows.length,
          exceptionCount: result.exceptionCount,
          sourceHash,
        },
      },
      client,
    );
    return { importBatchId, rowCount: normalizedRows.length, ...result };
  });
}

export async function recompareSettlementImport(
  actor: Actor,
  importBatchId: string,
) {
  return transaction(async (client) => {
    const result = await compareSettlementImport(actor, importBatchId, client);
    await recordAuditEvent(
      {
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        actorName: actor.name,
        action: "settlement_import.recompared",
        entityType: "settlement_import",
        entityId: importBatchId,
        details: result,
      },
      client,
    );
    return result;
  });
}

export async function proposeSettlementAdjustment(input: {
  actor: Actor;
  exceptionId: string;
  adjustmentType: SettlementAdjustmentType;
  amount: number;
  reason: string;
  evidenceReference: string;
}) {
  return transaction(async (client) => {
    const exception = await getExceptionForAdjustment(
      client,
      input.actor.organizationId,
      input.exceptionId,
    );
    if (!exception) throw new DomainError("Settlement exception not found.", 404);
    if (input.amount < 0) throw new DomainError("Adjustment amount is invalid.", 400);
    const reason = clean(input.reason);
    if (reason.length < 10) {
      throw new DomainError("Adjustment reason must be at least 10 characters.", 400);
    }
    const evidenceReference = clean(input.evidenceReference);
    if (evidenceReference.length < 4) {
      throw new DomainError("Evidence reference is required.", 400);
    }
    const adjustmentId = await insertAdjustmentProposal(client, {
      organizationId: input.actor.organizationId,
      exceptionId: input.exceptionId,
      adjustmentType: input.adjustmentType,
      amount: roundMoney(input.amount),
      reason,
      evidenceReference,
      proposedByUserId: input.actor.id,
      proposedByName: input.actor.name,
    });
    await insertAdjustmentEvent(client, {
      organizationId: input.actor.organizationId,
      adjustmentId,
      actorUserId: input.actor.id,
      actorName: input.actor.name,
      eventType: "proposed",
      details: { exceptionId: input.exceptionId, amount: input.amount },
    });
    await recordAuditEvent(
      {
        organizationId: input.actor.organizationId,
        actorUserId: input.actor.id,
        actorName: input.actor.name,
        action: "settlement_adjustment.proposed",
        entityType: "settlement_adjustment",
        entityId: adjustmentId,
        details: { exceptionId: input.exceptionId, amount: input.amount },
      },
      client,
    );
    return { adjustmentId };
  });
}

export async function changeSettlementAdjustment(input: {
  actor: Actor;
  adjustmentId: string;
  action: "approve" | "reject" | "withdraw";
  reason?: string;
}) {
  return transaction(async (client) => {
    const adjustment = await getAdjustmentForUpdate(
      client,
      input.actor.organizationId,
      input.adjustmentId,
    );
    if (!adjustment) throw new DomainError("Settlement adjustment not found.", 404);
    if (adjustment.status !== "proposed") {
      throw new DomainError("Only proposed adjustments can be changed.", 409);
    }
    if (
      (input.action === "approve" || input.action === "reject") &&
      input.actor.role !== "admin"
    ) {
      throw new DomainError("Only administrators can decide adjustments.", 403);
    }
    if (input.action === "approve" && adjustment.proposed_by_user_id === input.actor.id) {
      throw new DomainError("A different administrator must approve this adjustment.", 403);
    }
    const status =
      input.action === "approve"
        ? "approved"
        : input.action === "reject"
          ? "rejected"
          : "withdrawn";
    const reason = clean(input.reason ?? "");
    if ((status === "approved" || status === "rejected") && reason.length < 10) {
      throw new DomainError("Decision reason must be at least 10 characters.", 400);
    }
    await updateAdjustmentStatus(client, {
      organizationId: input.actor.organizationId,
      adjustmentId: input.adjustmentId,
      exceptionId: adjustment.exception_id,
      status,
      actorUserId: input.actor.id,
      actorName: input.actor.name,
      reason: status === "withdrawn" ? null : reason,
    });
    await insertAdjustmentEvent(client, {
      organizationId: input.actor.organizationId,
      adjustmentId: input.adjustmentId,
      actorUserId: input.actor.id,
      actorName: input.actor.name,
      eventType: status,
      details: { reason: reason || null },
    });
    await recordAuditEvent(
      {
        organizationId: input.actor.organizationId,
        actorUserId: input.actor.id,
        actorName: input.actor.name,
        action: `settlement_adjustment.${status}`,
        entityType: "settlement_adjustment",
        entityId: input.adjustmentId,
        details: { reason: reason || null },
      },
      client,
    );
    return { adjustmentId: input.adjustmentId, status };
  });
}

export async function buildEvidencePacket(actor: Actor, importBatchId: string) {
  const detail = await getImportDetail(importBatchId, actor.organizationId);
  if (!detail) throw new DomainError("Settlement import not found.", 404);
  const packet = {
    packetType: "settlement_import_evidence",
    generatedAt: new Date().toISOString(),
    generatedBy: actor.name,
    syntheticOnly: true,
    import: {
      id: detail.id,
      providerId: detail.providerId,
      importReference: detail.importReference,
      sourceFilename: detail.sourceFilename,
      sourceHash: detail.sourceHash,
      rowCount: detail.rowCount,
      exceptionCount: detail.exceptionCount,
    },
    rows: detail.rows.map((row) => ({
      rowNumber: row.rowNumber,
      statementReference: row.statementReference,
      orderId: row.orderId,
      gatewayReference: row.gatewayReference,
      grossAmount: row.grossAmount,
      deductionAmount: row.deductionAmount,
      netAmount: row.netAmount,
      utrPresent: Boolean(row.utr),
      settlementStatus: row.settlementStatus,
    })),
    exceptions: detail.exceptions.map((exception) => ({
      id: exception.id,
      type: exception.exceptionType,
      priority: exception.priority,
      status: exception.status,
      exposureAmount: exception.exposureAmount,
      summary: exception.summary,
      linkedOperationsCase: Boolean(exception.operationsCaseId),
      adjustmentStatus: exception.adjustment?.status ?? "none",
    })),
    boundary:
      "Synthetic portfolio evidence only. No live provider, bank, payout, or money-moving behavior.",
  };
  const packetHash = sha256(JSON.stringify(packet));
  await transaction(async (client) => {
    await insertEvidencePacket(client, {
      organizationId: actor.organizationId,
      importBatchId,
      packetReference: `PKT-${detail.importReference}`,
      generatedByUserId: actor.id,
      generatedByName: actor.name,
      packetHash,
      metadata: { exceptionCount: detail.exceptionCount, rowCount: detail.rowCount },
    });
  });
  return { ...packet, packetHash };
}

export function parseSettlementImportCsv(
  csvText: string,
): NormalizedSettlementImportRow[] {
  if (csvText.length > 2_000_000) {
    throw new DomainError("Statement import CSV is too large for the demo.", 400);
  }
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: normalizeHeader,
  });
  if (parsed.errors.length) {
    throw new DomainError(`CSV parse failed: ${parsed.errors[0].message}`, 400);
  }
  const rows = parsed.data.filter((row) =>
    Object.values(row).some((value) => clean(value).length > 0),
  );
  if (!rows.length) throw new DomainError("Statement import CSV has no rows.", 400);
  if (rows.length > 500) {
    throw new DomainError("Statement import demo accepts at most 500 rows.", 400);
  }
  return rows.map((row, index) => normalizeRow(row, index + 1));
}

async function compareSettlementImport(
  actor: Actor,
  importBatchId: string,
  client: PoolClient,
) {
  await replaceComparisons(client, actor.organizationId, importBatchId);
  const rows = await loadRowsForComparison(
    client,
    actor.organizationId,
    importBatchId,
  );
  let matchedRows = 0;
  let exceptionCount = 0;
  for (const row of rows) {
    const match = await findLedgerMatch(client, actor.organizationId, row);
    const duplicateUtrCount = await countDuplicateUtr(
      client,
      actor.organizationId,
      importBatchId,
      row.utr,
    );
    const classification = classifyImportedRow({
      row,
      match,
      duplicateUtrCount,
      now: new Date(),
    });
    const comparisonId = await insertComparison(client, {
      organizationId: actor.organizationId,
      importBatchId,
      importRowId: row.id,
      settlementBatchId: match?.settlement_batch_id ?? null,
      settlementLineId: match?.settlement_line_id ?? null,
      bankCreditId: match?.bank_credit_id ?? null,
      operationsCaseId: match?.operations_case_id ?? null,
      comparisonStatus: classification.exceptionType ? "exception" : "matched",
      exceptionType: classification.exceptionType,
      amountVariance: classification.amountVariance,
      deductionVariance: classification.deductionVariance,
      evidence: classification.evidence,
    });
    if (classification.exceptionType) {
      exceptionCount += 1;
      await insertException(client, {
        organizationId: actor.organizationId,
        importBatchId,
        comparisonId,
        importRowId: row.id,
        settlementBatchId: match?.settlement_batch_id ?? null,
        operationsCaseId: match?.operations_case_id ?? null,
        exceptionType: classification.exceptionType,
        priority: classification.priority,
        exposureAmount: classification.exposureAmount,
        summary: classification.summary,
        evidence: classification.evidence,
      });
    } else {
      matchedRows += 1;
    }
  }
  await updateImportStatus(client, actor.organizationId, importBatchId);
  return { comparedRows: rows.length, matchedRows, exceptionCount };
}

type ComparableRow = Awaited<ReturnType<typeof loadRowsForComparison>>[number];
type LedgerMatch = Awaited<ReturnType<typeof findLedgerMatch>>;

export function classifyImportedRow(input: {
  row: ComparableRow;
  match: LedgerMatch;
  duplicateUtrCount: number;
  now: Date;
}) {
  const row = input.row;
  const match = input.match;
  const amountVariance = roundMoney(
    Number(row.net_amount) - Number(match?.batch_net_amount ?? 0),
  );
  const deductionVariance = roundMoney(
    Number(row.deduction_amount) - Number(match?.batch_deduction_amount ?? 0),
  );
  let exceptionType: SettlementImportExceptionType | null = null;
  if (row.settlement_status === "failed") exceptionType = "failed_payout";
  else if (row.settlement_status === "held") exceptionType = "held_settlement";
  else if (
    row.deduction_type &&
    ["refund", "chargeback"].includes(row.deduction_type) &&
    Number(row.deduction_amount) > 0 &&
    Math.abs(deductionVariance) >= 0.01
  ) {
    exceptionType = "forward_deduction_mismatch";
  } else if (row.deduction_type === "hold" && Number(row.deduction_amount) > 0) {
    exceptionType = "unexplained_hold";
  } else if (!row.utr) exceptionType = "missing_utr";
  else if (input.duplicateUtrCount > 1) exceptionType = "duplicate_utr";
  else if (row.settlement_status === "sent" && !match?.bank_credit_id) {
    exceptionType = "retry_exhausted";
  } else if (
    row.expected_settlement_at &&
    new Date(row.expected_settlement_at) < input.now &&
    !match?.bank_credit_id
  ) {
    exceptionType = "delayed_credit";
  } else if (!match?.bank_credit_id) exceptionType = "utr_not_found";
  else if (Math.abs(amountVariance) >= 0.01) exceptionType = "amount_mismatch";
  else if (Math.abs(deductionVariance) >= 0.01) exceptionType = "deduction_mismatch";

  const exposureAmount = exceptionType
    ? roundMoney(Math.max(Math.abs(amountVariance), Math.abs(deductionVariance), Number(row.net_amount)))
    : 0;
  return {
    exceptionType,
    amountVariance,
    deductionVariance,
    exposureAmount,
    priority:
      exceptionType === "amount_mismatch" ||
      exceptionType === "failed_payout" ||
      exceptionType === "duplicate_utr"
        ? ("high" as const)
        : exceptionType
          ? ("medium" as const)
          : ("low" as const),
    summary: exceptionType
      ? `${label(exceptionType)} on imported statement ${row.statement_reference} for order ${row.order_id}.`
      : `Imported statement row ${row.row_number} matched existing settlement evidence.`,
    evidence: {
      reason: exceptionType
        ? label(exceptionType)
        : "Imported row matches settlement ledger evidence.",
      rowNumber: row.row_number,
      statementReference: row.statement_reference,
      orderId: row.order_id,
      gatewayReference: row.gateway_reference,
      ledgerBatchMatched: Boolean(match?.settlement_batch_id),
      bankCreditMatched: Boolean(match?.bank_credit_id),
      operationsCaseLinked: Boolean(match?.operations_case_id),
      amountVariance,
      deductionVariance,
    },
  };
}

function normalizeRow(
  row: Record<string, string>,
  rowNumber: number,
): NormalizedSettlementImportRow {
  const grossAmount = amount(read(row, ["gross_amount", "amount", "collected_amount"]));
  const deductionAmount = amount(read(row, ["deduction_amount", "deductions", "fee", "fees"]), 0);
  const netAmount = roundMoney(grossAmount - deductionAmount);
  if (netAmount < 0) {
    throw new DomainError(`Row ${rowNumber} deductions exceed gross amount.`, 400);
  }
  const deductionType = normalizeDeductionType(read(row, ["deduction_type", "fee_type", "adjustment_type"]));
  const settlementStatus = normalizeSettlementStatus(read(row, ["settlement_status", "status"]));
  const normalized = {
    statementReference: required(row, rowNumber, ["statement_reference", "settlement_id", "batch_id"]),
    merchantReference: required(row, rowNumber, ["merchant_reference", "merchant_id", "merchant_code"]),
    orderId: required(row, rowNumber, ["order_id", "merchant_order_id", "receipt"]),
    gatewayReference: required(row, rowNumber, ["gateway_reference", "payment_id", "txn_id"]),
    paymentMode: clean(read(row, ["payment_mode", "method", "mode"])) || "UPI",
    grossAmount,
    deductionAmount,
    netAmount,
    deductionType,
    utr: nullable(read(row, ["utr", "settlement_utr", "bank_reference"])),
    bankReference: nullable(read(row, ["bank_reference", "bank_ref"])),
    settlementStatus,
    expectedSettlementAt: nullableDate(read(row, ["expected_settlement_at", "expected_date"])),
    actualSettlementAt: nullableDate(read(row, ["actual_settlement_at", "settled_at", "settlement_date"])),
  };
  return {
    rowNumber,
    ...normalized,
    rawValues: row,
    normalizedValues: normalized,
    rowFingerprint: sha256(stableJson(normalized)),
  };
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function required(row: Record<string, string>, rowNumber: number, keys: string[]) {
  const value = clean(read(row, keys));
  if (!value) throw new DomainError(`Row ${rowNumber} is missing ${keys[0]}.`, 400);
  return value;
}

function read(row: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && clean(value)) return value;
  }
  return "";
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function nullable(value: string) {
  const cleaned = clean(value);
  return cleaned || null;
}

function amount(value: string, fallback?: number) {
  const cleaned = clean(value).replace(/₹|,/g, "");
  if (!cleaned && fallback !== undefined) return fallback;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new DomainError("Invalid settlement import amount.", 400);
  }
  return roundMoney(parsed);
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function normalizeDeductionType(value: string) {
  const normalized = clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return deductionTypes.includes(normalized) ? normalized : null;
}

function normalizeSettlementStatus(value: string): NormalizedSettlementImportRow["settlementStatus"] {
  const normalized = clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return settlementStatuses.includes(
    normalized as NormalizedSettlementImportRow["settlementStatus"],
  )
    ? (normalized as NormalizedSettlementImportRow["settlementStatus"])
    : "credited";
}

function nullableDate(value: string) {
  const cleaned = clean(value);
  if (!cleaned) return null;
  const date = new Date(cleaned);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function label(value: string) {
  return value.replaceAll("_", " ");
}

function sanitizeFilename(value: string) {
  return clean(value).slice(0, 220) || "settlement-import.csv";
}
