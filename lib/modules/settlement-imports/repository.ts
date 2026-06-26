import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import type {
  NormalizedSettlementImportRow,
  SettlementAdjustmentProposal,
  SettlementImportBatch,
  SettlementImportComparison,
  SettlementImportDetail,
  SettlementImportException,
  SettlementImportExceptionType,
  SettlementImportFilters,
  SettlementImportSummary,
} from "@/lib/modules/settlement-imports/types";
import type { ProviderId } from "@/lib/types";

export async function lockSettlementImport(client: PoolClient, organizationId: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 20020))", [
    organizationId,
  ]);
}

export async function upsertImportBatch(
  client: PoolClient,
  input: {
    organizationId: string;
    providerId: ProviderId;
    importReference: string;
    sourceFilename: string;
    sourceHash: string;
    rowCount: number;
    evidence: Record<string, unknown>;
    seedMarker?: string | null;
    importedByUserId: string | null;
    importedByName: string;
  },
) {
  const result = await client.query<{ id: string }>(
    `INSERT INTO settlement_import_batches (
       organization_id, provider_id, import_reference, source_filename,
       source_hash, row_count, evidence, seed_marker,
       imported_by_user_id, imported_by_name
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (organization_id, provider_id, source_hash)
     DO UPDATE SET
       import_reference = EXCLUDED.import_reference,
       source_filename = EXCLUDED.source_filename,
       row_count = EXCLUDED.row_count,
       evidence = EXCLUDED.evidence,
       seed_marker = EXCLUDED.seed_marker,
       imported_by_user_id = EXCLUDED.imported_by_user_id,
       imported_by_name = EXCLUDED.imported_by_name,
       status = 'staged',
       exception_count = 0,
       updated_at = NOW()
     RETURNING id`,
    [
      input.organizationId,
      input.providerId,
      input.importReference,
      input.sourceFilename,
      input.sourceHash,
      input.rowCount,
      JSON.stringify(input.evidence),
      input.seedMarker ?? null,
      input.importedByUserId,
      input.importedByName,
    ],
  );
  return result.rows[0].id;
}

export async function replaceImportRows(
  client: PoolClient,
  organizationId: string,
  importBatchId: string,
  rows: NormalizedSettlementImportRow[],
) {
  await client.query(
    "DELETE FROM settlement_import_rows WHERE organization_id = $1 AND import_batch_id = $2",
    [organizationId, importBatchId],
  );
  for (const row of rows) {
    await client.query(
      `INSERT INTO settlement_import_rows (
         organization_id, import_batch_id, row_number, row_fingerprint,
         statement_reference, merchant_reference, order_id, gateway_reference,
         payment_mode, gross_amount, deduction_amount, net_amount,
         deduction_type, utr, bank_reference, settlement_status,
         expected_settlement_at, actual_settlement_at,
         raw_values, normalized_values
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
       )`,
      [
        organizationId,
        importBatchId,
        row.rowNumber,
        row.rowFingerprint,
        row.statementReference,
        row.merchantReference,
        row.orderId,
        row.gatewayReference,
        row.paymentMode,
        row.grossAmount,
        row.deductionAmount,
        row.netAmount,
        row.deductionType,
        row.utr,
        row.bankReference,
        row.settlementStatus,
        row.expectedSettlementAt,
        row.actualSettlementAt,
        JSON.stringify(row.rawValues),
        JSON.stringify(row.normalizedValues),
      ],
    );
  }
}

export async function loadRowsForComparison(
  client: PoolClient,
  organizationId: string,
  importBatchId: string,
) {
  const result = await client.query<{
    id: string;
    row_number: number;
    statement_reference: string;
    merchant_reference: string;
    order_id: string;
    gateway_reference: string;
    payment_mode: string;
    gross_amount: string;
    deduction_amount: string;
    net_amount: string;
    deduction_type: string | null;
    utr: string | null;
    bank_reference: string | null;
    settlement_status: NormalizedSettlementImportRow["settlementStatus"];
    expected_settlement_at: Date | null;
    actual_settlement_at: Date | null;
  }>(
    `SELECT id, row_number, statement_reference, merchant_reference, order_id,
       gateway_reference, payment_mode, gross_amount::text, deduction_amount::text,
       net_amount::text, deduction_type, utr, bank_reference, settlement_status,
       expected_settlement_at, actual_settlement_at
     FROM settlement_import_rows
     WHERE organization_id = $1 AND import_batch_id = $2
     ORDER BY row_number`,
    [organizationId, importBatchId],
  );
  return result.rows;
}

export async function findLedgerMatch(
  client: PoolClient,
  organizationId: string,
  row: {
    statement_reference: string;
    order_id: string;
    gateway_reference: string;
    utr: string | null;
  },
) {
  const result = await client.query<{
    settlement_batch_id: string | null;
    settlement_line_id: string | null;
    bank_credit_id: string | null;
    operations_case_id: string | null;
    batch_net_amount: string | null;
    batch_deduction_amount: string | null;
    batch_utr: string | null;
    bank_credit_amount: string | null;
    bank_match_status: string | null;
  }>(
    `SELECT batch.id AS settlement_batch_id,
       line.id AS settlement_line_id,
       credit.id AS bank_credit_id,
       payment_case.id AS operations_case_id,
       batch.net_amount::text AS batch_net_amount,
       batch.deduction_amount::text AS batch_deduction_amount,
       batch.utr AS batch_utr,
       credit.amount::text AS bank_credit_amount,
       credit.match_status AS bank_match_status
     FROM merchant_settlement_batches batch
     LEFT JOIN merchant_settlement_lines line
       ON line.batch_id = batch.id
      AND line.organization_id = batch.organization_id
      AND (
        line.order_id = $3
        OR line.gateway_reference = $4
      )
     LEFT JOIN merchant_settlement_bank_credits credit
       ON credit.organization_id = batch.organization_id
      AND (
        credit.batch_id = batch.id
        OR ($5::text IS NOT NULL AND credit.utr = $5)
      )
     LEFT JOIN merchant_settlement_case_links case_link
       ON case_link.organization_id = batch.organization_id
      AND case_link.batch_id = batch.id
      AND (case_link.line_id = line.id OR case_link.line_id IS NULL)
     LEFT JOIN operations_cases payment_case
       ON payment_case.id = case_link.case_id
      AND payment_case.organization_id = case_link.organization_id
     WHERE batch.organization_id = $1
       AND (
         batch.statement_reference = $2
         OR line.id IS NOT NULL
         OR ($5::text IS NOT NULL AND credit.id IS NOT NULL)
       )
     ORDER BY
       CASE WHEN batch.statement_reference = $2 THEN 0 ELSE 1 END,
       CASE WHEN line.id IS NOT NULL THEN 0 ELSE 1 END,
       CASE WHEN credit.id IS NOT NULL THEN 0 ELSE 1 END
     LIMIT 1`,
    [
      organizationId,
      row.statement_reference,
      row.order_id,
      row.gateway_reference,
      row.utr,
    ],
  );
  return result.rows[0] ?? null;
}

export async function countDuplicateUtr(
  client: PoolClient,
  organizationId: string,
  importBatchId: string,
  utr: string | null,
) {
  if (!utr) return 0;
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM settlement_import_rows
     WHERE organization_id = $1 AND import_batch_id = $2 AND utr = $3`,
    [organizationId, importBatchId, utr],
  );
  return Number(result.rows[0].count);
}

export async function replaceComparisons(
  client: PoolClient,
  organizationId: string,
  importBatchId: string,
) {
  await client.query(
    "DELETE FROM settlement_import_comparisons WHERE organization_id = $1 AND import_batch_id = $2",
    [organizationId, importBatchId],
  );
}

export async function insertComparison(
  client: PoolClient,
  input: {
    organizationId: string;
    importBatchId: string;
    importRowId: string;
    settlementBatchId: string | null;
    settlementLineId: string | null;
    bankCreditId: string | null;
    operationsCaseId: string | null;
    comparisonStatus: "matched" | "exception";
    exceptionType: SettlementImportExceptionType | null;
    amountVariance: number;
    deductionVariance: number;
    evidence: Record<string, unknown>;
  },
) {
  const result = await client.query<{ id: string }>(
    `INSERT INTO settlement_import_comparisons (
       organization_id, import_batch_id, import_row_id,
       settlement_batch_id, settlement_line_id, bank_credit_id,
       operations_case_id, comparison_status, exception_type,
       amount_variance, deduction_variance, evidence
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id`,
    [
      input.organizationId,
      input.importBatchId,
      input.importRowId,
      input.settlementBatchId,
      input.settlementLineId,
      input.bankCreditId,
      input.operationsCaseId,
      input.comparisonStatus,
      input.exceptionType,
      input.amountVariance,
      input.deductionVariance,
      JSON.stringify(input.evidence),
    ],
  );
  return result.rows[0].id;
}

export async function insertException(
  client: PoolClient,
  input: {
    organizationId: string;
    importBatchId: string;
    comparisonId: string;
    importRowId: string;
    settlementBatchId: string | null;
    operationsCaseId: string | null;
    exceptionType: SettlementImportExceptionType;
    priority: "low" | "medium" | "high";
    exposureAmount: number;
    summary: string;
    evidence: Record<string, unknown>;
  },
) {
  await client.query(
    `INSERT INTO settlement_import_exceptions (
       organization_id, import_batch_id, comparison_id, import_row_id,
       settlement_batch_id, operations_case_id, exception_type,
       priority, exposure_amount, summary, evidence
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      input.organizationId,
      input.importBatchId,
      input.comparisonId,
      input.importRowId,
      input.settlementBatchId,
      input.operationsCaseId,
      input.exceptionType,
      input.priority,
      input.exposureAmount,
      input.summary,
      JSON.stringify(input.evidence),
    ],
  );
}

export async function updateImportStatus(
  client: PoolClient,
  organizationId: string,
  importBatchId: string,
) {
  const result = await client.query<{ exceptions: string }>(
    `SELECT COUNT(*)::text AS exceptions
     FROM settlement_import_exceptions
     WHERE organization_id = $1 AND import_batch_id = $2`,
    [organizationId, importBatchId],
  );
  const exceptionCount = Number(result.rows[0].exceptions);
  await client.query(
    `UPDATE settlement_import_batches
     SET status = $3, exception_count = $4, updated_at = NOW()
     WHERE organization_id = $1 AND id = $2`,
    [
      organizationId,
      importBatchId,
      exceptionCount ? "needs_review" : "compared",
      exceptionCount,
    ],
  );
  return exceptionCount;
}

export async function listSettlementImports(
  organizationId: string,
  filters: SettlementImportFilters,
): Promise<SettlementImportWorkspaceRows> {
  const imports = await query<ImportRow>(
    `SELECT id, provider_id, import_reference, source_filename, source_hash,
       status, row_count, exception_count, imported_by_name,
       imported_at, updated_at
     FROM settlement_import_batches
     WHERE organization_id = $1
       AND ($2::text = 'all' OR provider_id = $2)
       AND ($3::text = 'all' OR status = $3)
     ORDER BY imported_at DESC
     LIMIT 50`,
    [organizationId, filters.provider, filters.status],
  );
  const exceptions = await query<ExceptionRow>(
    exceptionSelectSql(
      `exception.organization_id = $1
       AND ($2::text = 'all' OR batch.provider_id = $2)
       AND ($3::text = 'all' OR exception.exception_type = $3)
       AND (
         $4::text = 'all'
         OR ($4::text = 'none' AND adjustment.id IS NULL)
         OR adjustment.status = $4
       )
       AND (
         $5::text = 'all'
         OR ($5::text = 'linked' AND exception.operations_case_id IS NOT NULL)
         OR ($5::text = 'unlinked' AND exception.operations_case_id IS NULL)
       )`,
    ),
    [
      organizationId,
      filters.provider,
      filters.exceptionType,
      filters.adjustmentState,
      filters.linkedCase,
    ],
  );
  return {
    imports: imports.rows.map(mapImport),
    latestExceptions: exceptions.rows.map(mapException),
  };
}

export async function getImportDetail(
  importBatchId: string,
  organizationId: string,
): Promise<SettlementImportDetail | null> {
  const batch = await query<ImportRow>(
    `SELECT id, provider_id, import_reference, source_filename, source_hash,
       status, row_count, exception_count, imported_by_name,
       imported_at, updated_at
     FROM settlement_import_batches
     WHERE id = $1 AND organization_id = $2`,
    [importBatchId, organizationId],
  );
  if (!batch.rowCount) return null;
  const [rows, comparisons, exceptions, summary] = await Promise.all([
    query<RowDetail>(
      `SELECT row_number, statement_reference, merchant_reference, order_id,
         gateway_reference, payment_mode, gross_amount::text,
         deduction_amount::text, net_amount::text, deduction_type, utr,
         bank_reference, settlement_status, expected_settlement_at,
         actual_settlement_at, raw_values, normalized_values, row_fingerprint
       FROM settlement_import_rows
       WHERE organization_id = $1 AND import_batch_id = $2
       ORDER BY row_number`,
      [organizationId, importBatchId],
    ),
    query<ComparisonRow>(
      `SELECT id, import_row_id, settlement_batch_id, settlement_line_id,
         bank_credit_id, operations_case_id, comparison_status, exception_type,
         amount_variance::text, deduction_variance::text, evidence, compared_at
       FROM settlement_import_comparisons
       WHERE organization_id = $1 AND import_batch_id = $2
       ORDER BY compared_at DESC`,
      [organizationId, importBatchId],
    ),
    query<ExceptionRow>(
      exceptionSelectSql("exception.organization_id = $1 AND exception.import_batch_id = $2"),
      [organizationId, importBatchId],
    ),
    getSettlementImportSummary(organizationId),
  ]);
  return {
    ...mapImport(batch.rows[0]),
    rows: rows.rows.map(mapDetailRow),
    comparisons: comparisons.rows.map(mapComparison),
    exceptions: exceptions.rows.map(mapException),
    summary,
  };
}

export async function getSettlementImportSummary(
  organizationId: string,
): Promise<SettlementImportSummary> {
  const result = await query<{
    imports: string;
    imported_rows: string;
    matched_rows: string;
    exceptions: string;
    open_exceptions: string;
    proposed_adjustments: string;
    approved_adjustments: string;
    exposure_amount: string;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM settlement_import_batches WHERE organization_id = $1)::text AS imports,
       (SELECT COUNT(*) FROM settlement_import_rows WHERE organization_id = $1)::text AS imported_rows,
       (SELECT COUNT(*) FROM settlement_import_comparisons WHERE organization_id = $1 AND comparison_status = 'matched')::text AS matched_rows,
       (SELECT COUNT(*) FROM settlement_import_exceptions WHERE organization_id = $1)::text AS exceptions,
       (SELECT COUNT(*) FROM settlement_import_exceptions WHERE organization_id = $1 AND status <> 'resolved')::text AS open_exceptions,
       (SELECT COUNT(*) FROM settlement_adjustment_proposals WHERE organization_id = $1 AND status = 'proposed')::text AS proposed_adjustments,
       (SELECT COUNT(*) FROM settlement_adjustment_proposals WHERE organization_id = $1 AND status = 'approved')::text AS approved_adjustments,
       COALESCE((SELECT SUM(exposure_amount) FROM settlement_import_exceptions WHERE organization_id = $1), 0)::text AS exposure_amount`,
    [organizationId],
  );
  const row = result.rows[0];
  return {
    imports: Number(row.imports),
    importedRows: Number(row.imported_rows),
    matchedRows: Number(row.matched_rows),
    exceptions: Number(row.exceptions),
    openExceptions: Number(row.open_exceptions),
    proposedAdjustments: Number(row.proposed_adjustments),
    approvedAdjustments: Number(row.approved_adjustments),
    exposureAmount: Number(row.exposure_amount),
  };
}

export async function getExceptionForAdjustment(
  client: PoolClient,
  organizationId: string,
  exceptionId: string,
) {
  const result = await client.query<{ id: string; exposure_amount: string }>(
    `SELECT id, exposure_amount::text
     FROM settlement_import_exceptions
     WHERE organization_id = $1 AND id = $2`,
    [organizationId, exceptionId],
  );
  return result.rows[0] ?? null;
}

export async function insertAdjustmentProposal(
  client: PoolClient,
  input: {
    organizationId: string;
    exceptionId: string;
    adjustmentType: string;
    amount: number;
    reason: string;
    evidenceReference: string;
    proposedByUserId: string;
    proposedByName: string;
  },
) {
  const result = await client.query<{ id: string }>(
    `INSERT INTO settlement_adjustment_proposals (
       organization_id, exception_id, adjustment_type, amount, reason,
       evidence_reference, proposed_by_user_id, proposed_by_name
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [
      input.organizationId,
      input.exceptionId,
      input.adjustmentType,
      input.amount,
      input.reason,
      input.evidenceReference,
      input.proposedByUserId,
      input.proposedByName,
    ],
  );
  await client.query(
    `UPDATE settlement_import_exceptions
     SET status = 'adjustment_proposed', updated_at = NOW()
     WHERE organization_id = $1 AND id = $2`,
    [input.organizationId, input.exceptionId],
  );
  return result.rows[0].id;
}

export async function getAdjustmentForUpdate(
  client: PoolClient,
  organizationId: string,
  adjustmentId: string,
) {
  const result = await client.query<{
    id: string;
    exception_id: string;
    status: string;
    proposed_by_user_id: string | null;
  }>(
    `SELECT id, exception_id, status, proposed_by_user_id
     FROM settlement_adjustment_proposals
     WHERE organization_id = $1 AND id = $2
     FOR UPDATE`,
    [organizationId, adjustmentId],
  );
  return result.rows[0] ?? null;
}

export async function updateAdjustmentStatus(
  client: PoolClient,
  input: {
    organizationId: string;
    adjustmentId: string;
    exceptionId: string;
    status: "approved" | "rejected" | "withdrawn";
    actorUserId: string;
    actorName: string;
    reason: string | null;
  },
) {
  await client.query(
    `UPDATE settlement_adjustment_proposals
     SET status = $3,
       decided_by_user_id = CASE WHEN $3 IN ('approved','rejected') THEN $4 ELSE decided_by_user_id END,
       decided_by_name = CASE WHEN $3 IN ('approved','rejected') THEN $5 ELSE decided_by_name END,
       decision_reason = CASE WHEN $3 IN ('approved','rejected') THEN $6 ELSE decision_reason END,
       decided_at = CASE WHEN $3 IN ('approved','rejected') THEN NOW() ELSE decided_at END,
       updated_at = NOW()
     WHERE organization_id = $1 AND id = $2`,
    [
      input.organizationId,
      input.adjustmentId,
      input.status,
      input.actorUserId,
      input.actorName,
      input.reason,
    ],
  );
  if (input.status === "approved") {
    await client.query(
      `UPDATE settlement_import_exceptions
       SET status = 'resolved', updated_at = NOW()
       WHERE organization_id = $1 AND id = $2`,
      [input.organizationId, input.exceptionId],
    );
  }
}

export async function insertAdjustmentEvent(
  client: PoolClient,
  input: {
    organizationId: string;
    adjustmentId: string;
    actorUserId: string;
    actorName: string;
    eventType: string;
    details: Record<string, unknown>;
  },
) {
  await client.query(
    `INSERT INTO settlement_adjustment_events (
       organization_id, adjustment_id, actor_user_id, actor_name, event_type, details
     ) VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      input.organizationId,
      input.adjustmentId,
      input.actorUserId,
      input.actorName,
      input.eventType,
      JSON.stringify(input.details),
    ],
  );
}

export async function insertEvidencePacket(
  client: PoolClient,
  input: {
    organizationId: string;
    importBatchId: string;
    packetReference: string;
    generatedByUserId: string;
    generatedByName: string;
    packetHash: string;
    metadata: Record<string, unknown>;
  },
) {
  await client.query(
    `INSERT INTO settlement_evidence_packets (
       organization_id, import_batch_id, packet_reference, generated_by_user_id,
       generated_by_name, packet_hash, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (organization_id, packet_reference)
     DO UPDATE SET generated_at = NOW(), packet_hash = EXCLUDED.packet_hash,
       metadata = EXCLUDED.metadata`,
    [
      input.organizationId,
      input.importBatchId,
      input.packetReference,
      input.generatedByUserId,
      input.generatedByName,
      input.packetHash,
      JSON.stringify(input.metadata),
    ],
  );
}

type ImportRow = {
  id: string;
  provider_id: ProviderId;
  import_reference: string;
  source_filename: string;
  source_hash: string;
  status: SettlementImportBatch["status"];
  row_count: number;
  exception_count: number;
  imported_by_name: string;
  imported_at: Date;
  updated_at: Date;
};
type RowDetail = {
  row_number: number;
  statement_reference: string;
  merchant_reference: string;
  order_id: string;
  gateway_reference: string;
  payment_mode: string;
  gross_amount: string;
  deduction_amount: string;
  net_amount: string;
  deduction_type: string | null;
  utr: string | null;
  bank_reference: string | null;
  settlement_status: NormalizedSettlementImportRow["settlementStatus"];
  expected_settlement_at: Date | null;
  actual_settlement_at: Date | null;
  raw_values: Record<string, string>;
  normalized_values: Record<string, unknown>;
  row_fingerprint: string;
};
type ComparisonRow = {
  id: string;
  import_row_id: string;
  settlement_batch_id: string | null;
  settlement_line_id: string | null;
  bank_credit_id: string | null;
  operations_case_id: string | null;
  comparison_status: "matched" | "exception";
  exception_type: SettlementImportExceptionType | null;
  amount_variance: string;
  deduction_variance: string;
  evidence: Record<string, unknown>;
  compared_at: Date;
};
type ExceptionRow = {
  id: string;
  import_batch_id: string;
  import_row_id: string;
  comparison_id: string;
  settlement_batch_id: string | null;
  operations_case_id: string | null;
  exception_type: SettlementImportExceptionType;
  priority: "low" | "medium" | "high";
  status: "open" | "adjustment_proposed" | "resolved";
  exposure_amount: string;
  summary: string;
  evidence: Record<string, unknown>;
  created_at: Date;
  adjustment_id: string | null;
  adjustment_type: SettlementAdjustmentProposal["adjustmentType"] | null;
  adjustment_amount: string | null;
  adjustment_reason: string | null;
  adjustment_evidence_reference: string | null;
  adjustment_status: SettlementAdjustmentProposal["status"] | null;
  proposed_by_name: string | null;
  decided_by_name: string | null;
  decision_reason: string | null;
  decided_at: Date | null;
  adjustment_created_at: Date | null;
};
type SettlementImportWorkspaceRows = {
  imports: SettlementImportBatch[];
  latestExceptions: SettlementImportException[];
};

function exceptionSelectSql(where: string) {
  return `SELECT exception.id, exception.import_batch_id, exception.import_row_id,
       exception.comparison_id, exception.settlement_batch_id,
       exception.operations_case_id, exception.exception_type, exception.priority,
       exception.status, exception.exposure_amount::text, exception.summary,
       exception.evidence, exception.created_at,
       adjustment.id AS adjustment_id,
       adjustment.adjustment_type, adjustment.amount::text AS adjustment_amount,
       adjustment.reason AS adjustment_reason,
       adjustment.evidence_reference AS adjustment_evidence_reference,
       adjustment.status AS adjustment_status,
       adjustment.proposed_by_name,
       adjustment.decided_by_name,
       adjustment.decision_reason,
       adjustment.decided_at,
       adjustment.created_at AS adjustment_created_at
     FROM settlement_import_exceptions exception
     JOIN settlement_import_batches batch
       ON batch.id = exception.import_batch_id
      AND batch.organization_id = exception.organization_id
     LEFT JOIN LATERAL (
       SELECT *
       FROM settlement_adjustment_proposals proposal
       WHERE proposal.organization_id = exception.organization_id
         AND proposal.exception_id = exception.id
       ORDER BY proposal.created_at DESC
       LIMIT 1
     ) adjustment ON true
     WHERE ${where}
     ORDER BY exception.created_at DESC
     LIMIT 50`;
}

function mapImport(row: ImportRow): SettlementImportBatch {
  return {
    id: row.id,
    providerId: row.provider_id,
    importReference: row.import_reference,
    sourceFilename: row.source_filename,
    sourceHash: row.source_hash,
    status: row.status,
    rowCount: row.row_count,
    exceptionCount: row.exception_count,
    importedByName: row.imported_by_name,
    importedAt: row.imported_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapDetailRow(row: RowDetail): NormalizedSettlementImportRow {
  return {
    rowNumber: row.row_number,
    statementReference: row.statement_reference,
    merchantReference: row.merchant_reference,
    orderId: row.order_id,
    gatewayReference: row.gateway_reference,
    paymentMode: row.payment_mode,
    grossAmount: Number(row.gross_amount),
    deductionAmount: Number(row.deduction_amount),
    netAmount: Number(row.net_amount),
    deductionType: row.deduction_type,
    utr: row.utr,
    bankReference: row.bank_reference,
    settlementStatus: row.settlement_status,
    expectedSettlementAt: row.expected_settlement_at?.toISOString() ?? null,
    actualSettlementAt: row.actual_settlement_at?.toISOString() ?? null,
    rawValues: row.raw_values,
    normalizedValues: row.normalized_values,
    rowFingerprint: row.row_fingerprint,
  };
}

function mapComparison(row: ComparisonRow): SettlementImportComparison {
  return {
    id: row.id,
    rowId: row.import_row_id,
    settlementBatchId: row.settlement_batch_id,
    settlementLineId: row.settlement_line_id,
    bankCreditId: row.bank_credit_id,
    operationsCaseId: row.operations_case_id,
    comparisonStatus: row.comparison_status,
    exceptionType: row.exception_type,
    amountVariance: Number(row.amount_variance),
    deductionVariance: Number(row.deduction_variance),
    evidence: row.evidence,
    comparedAt: row.compared_at.toISOString(),
  };
}

function mapException(row: ExceptionRow): SettlementImportException {
  return {
    id: row.id,
    importBatchId: row.import_batch_id,
    rowId: row.import_row_id,
    comparisonId: row.comparison_id,
    settlementBatchId: row.settlement_batch_id,
    operationsCaseId: row.operations_case_id,
    exceptionType: row.exception_type,
    priority: row.priority,
    status: row.status,
    exposureAmount: Number(row.exposure_amount),
    summary: row.summary,
    evidence: row.evidence,
    createdAt: row.created_at.toISOString(),
    adjustment: row.adjustment_id
      ? {
          id: row.adjustment_id,
          exceptionId: row.id,
          adjustmentType: row.adjustment_type!,
          amount: Number(row.adjustment_amount),
          reason: row.adjustment_reason!,
          evidenceReference: row.adjustment_evidence_reference!,
          status: row.adjustment_status!,
          proposedByName: row.proposed_by_name!,
          decidedByName: row.decided_by_name,
          decisionReason: row.decision_reason,
          decidedAt: row.decided_at?.toISOString() ?? null,
          createdAt: row.adjustment_created_at!.toISOString(),
        }
      : null,
  };
}
