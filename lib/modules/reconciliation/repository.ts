import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import type {
  ProviderId,
  ReconciliationResult,
  RunSummary,
} from "@/lib/types";
import { isCaseActionable } from "@/lib/settlement-policy";

export async function saveReconciliationRun(
  client: PoolClient,
  result: ReconciliationResult,
  metadata: {
    organizationId: string;
    name: string;
    sourceType: string;
    providerId: ProviderId;
    sourceFiles: Record<string, string>;
  },
) {
  const run = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO reconciliation_runs (
        organization_id, name, source_type, provider_id, total_orders, processed_value, matched_value,
        unmatched_value, matched_count, exception_count, match_rate, source_files
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING id, created_at`,
      [
        metadata.organizationId,
        metadata.name,
        metadata.sourceType,
        metadata.providerId,
        result.summary.totalOrders,
        result.summary.processedValue,
        result.summary.matchedValue,
        result.summary.unmatchedValue,
        result.summary.matchedCount,
        result.summary.exceptionCount,
        result.summary.matchRate,
        metadata.sourceFiles,
      ],
    );
  const runId = run.rows[0].id;

  for (const item of result.items) {
    const storedItem = await insertItem(
      client,
      metadata.organizationId,
      runId,
      item,
    );
    for (const evidence of item.sourceEvidence) {
      await client.query(
        `INSERT INTO reconciliation_source_evidence (
           organization_id, run_id, item_id, source_type, row_number,
           normalized_values, source_values, integrity_hash
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          metadata.organizationId,
          runId,
          storedItem.id,
          evidence.sourceType,
          evidence.rowNumber,
          JSON.stringify(evidence.normalizedValues),
          JSON.stringify(evidence.sourceValues),
          evidence.integrityHash,
        ],
      );
    }
    if (
      isCaseActionable({
        reconciliationStatus: item.status,
        settlementStatus: item.settlementStatus,
      })
    ) {
      await client.query(
          `INSERT INTO operations_cases (
             organization_id, item_id, run_id, priority, due_at, case_origin
           )
           VALUES (
             $1, $2, $3, $4,
             NOW() + CASE $4
               WHEN 'high' THEN INTERVAL '4 hours'
               WHEN 'medium' THEN INTERVAL '24 hours'
               ELSE INTERVAL '72 hours'
             END,
             $5
           )`,
          [
            metadata.organizationId,
            storedItem.id,
            runId,
            item.severity,
            item.status === "missing_settlement"
              ? "settlement_overdue"
              : "reconciliation_exception",
          ],
        );
    }
  }

  return {
    ...result,
    id: runId,
    generatedAt: run.rows[0].created_at.toISOString(),
  };
}

async function insertItem(
  client: PoolClient,
  organizationId: string,
  runId: string,
  item: ReconciliationResult["items"][number],
) {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO reconciliation_items (
      organization_id, run_id, order_id, gateway_reference, payment_mode, order_amount,
      gateway_amount, settled_amount, expected_net, variance,
      reconciliation_status, severity, summary, evidence, transaction_at,
      transaction_timestamp_source, settlement_recorded_at, settlement_cycle,
      expected_settlement_at, settlement_policy_version,
      settlement_calendar_version, settlement_timing_evidence
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
    )
    RETURNING id`,
    [
      organizationId,
      runId,
      item.orderId,
      item.gatewayReference,
      item.paymentMode,
      item.orderAmount,
      item.gatewayAmount,
      item.settledAmount,
      item.expectedNet,
      item.variance,
      item.status,
      item.severity,
      item.summary,
      JSON.stringify(item.evidence),
      item.transactionAt,
      item.transactionTimestampSource,
      item.settlementRecordedAt,
      item.settlementCycle,
      item.expectedSettlementAt,
      item.settlementPolicyVersion,
      item.settlementCalendarVersion,
      item.settlementTimingEvidence
        ? JSON.stringify(item.settlementTimingEvidence)
        : null,
    ],
  );
  return inserted.rows[0];
}

export async function listRuns(organizationId: string): Promise<RunSummary[]> {
  const result = await query<{
    id: string;
    name: string;
    source_type: string;
    status: string;
    provider_id: RunSummary["providerId"];
    total_orders: number;
    processed_value: string;
    matched_value: string;
    unmatched_value: string;
    matched_count: number;
    exception_count: number;
    match_rate: string;
    created_at: Date;
  }>(
    `SELECT * FROM reconciliation_runs
     WHERE organization_id = $1
     ORDER BY created_at DESC LIMIT 50`,
    [organizationId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    sourceType: row.source_type,
    providerId: row.provider_id,
    status: row.status,
    totalOrders: row.total_orders,
    processedValue: Number(row.processed_value),
    matchedValue: Number(row.matched_value),
    unmatchedValue: Number(row.unmatched_value),
    matchedCount: row.matched_count,
    exceptionCount: row.exception_count,
    matchRate: Number(row.match_rate),
    createdAt: row.created_at.toISOString(),
  }));
}
