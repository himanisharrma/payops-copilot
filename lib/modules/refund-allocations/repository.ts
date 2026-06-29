import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { ReasonCode } from "@/lib/types";
import type {
  RefundAllocation,
  RefundAllocationStatus,
} from "./types";

export type ParentItemSnapshot = {
  id: string;
  runId: string;
  settledAmount: number | null;
  expectedNet: number | null;
  reasonCode: ReasonCode | null;
};

// Slice 5: locate the most recent parent capture for a refund's order
// across ALL reconciliation runs in the org. Cross-run linkage is the
// core of the feature — a March capture refunded in May must still find
// its parent. `FOR UPDATE` serializes concurrent refresh hooks that
// touch the same parent item.
export async function findParentCaptureForRefund(
  client: PoolClient,
  organizationId: string,
  orderId: string,
): Promise<ParentItemSnapshot | null> {
  const result = await client.query<{
    id: string;
    run_id: string;
    settled_amount: string | null;
    expected_net: string | null;
    reason_code: ReasonCode | null;
  }>(
    `SELECT id, run_id,
            settled_amount::text AS settled_amount,
            expected_net::text AS expected_net,
            reason_code
       FROM reconciliation_items
      WHERE organization_id = $1
        AND order_id = $2
        AND reconciliation_status IN ('matched','amount_mismatch')
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE`,
    [organizationId, orderId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    runId: row.run_id,
    settledAmount: row.settled_amount === null ? null : Number(row.settled_amount),
    expectedNet: row.expected_net === null ? null : Number(row.expected_net),
    reasonCode: row.reason_code,
  };
}

// Insert a refund allocation. Idempotent via the partial unique index on
// (organization_id, refund_external_reference, parent_item_id) WHERE
// status = 'applied'. Re-running the refresh on the same refund row
// produces exactly one row; the second call's INSERT is a no-op.
export async function insertRefundAllocation(
  client: PoolClient,
  input: {
    organizationId: string;
    parentItemId: string;
    parentRunId: string;
    refundSourceRunId: string;
    refundExternalReference: string;
    refundOrderId: string;
    refundAmount: number;
    refundTransactionAt: string | null;
    refundSettlementAt: string | null;
    refundUtr: string | null;
    refundStatementReference: string | null;
  },
): Promise<{ inserted: boolean; id: string | null }> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO reconciliation_refund_allocations (
       organization_id, parent_item_id, parent_run_id, refund_source_run_id,
       refund_external_reference, refund_order_id, refund_amount,
       refund_transaction_at, refund_settlement_at, refund_utr,
       refund_statement_reference, status
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'applied'
     )
     ON CONFLICT (organization_id, refund_external_reference, parent_item_id)
       WHERE status = 'applied'
       DO NOTHING
     RETURNING id`,
    [
      input.organizationId,
      input.parentItemId,
      input.parentRunId,
      input.refundSourceRunId,
      input.refundExternalReference,
      input.refundOrderId,
      input.refundAmount,
      input.refundTransactionAt,
      input.refundSettlementAt,
      input.refundUtr,
      input.refundStatementReference,
    ],
  );
  return {
    inserted: result.rowCount === 1,
    id: result.rows[0]?.id ?? null,
  };
}

// Slice 6b — refund_allocations doesn't store provider directly; the
// linkage is parent_item_id → reconciliation_items → run → provider_id.
// Bridge 3 (refund netting → ledger) needs this for the per-PG card to
// attribute the refund to the right provider_receivable account.
export async function getProviderForAllocation(
  client: PoolClient,
  organizationId: string,
  parentItemId: string,
): Promise<string> {
  const result = await client.query<{ provider_id: string | null }>(
    `SELECT run.provider_id
       FROM reconciliation_items item
       JOIN reconciliation_runs run
         ON run.id = item.run_id AND run.organization_id = item.organization_id
      WHERE item.organization_id = $1 AND item.id = $2`,
    [organizationId, parentItemId],
  );
  return result.rows[0]?.provider_id ?? "generic";
}

export async function sumAppliedAllocationsForParent(
  client: PoolClient,
  organizationId: string,
  parentItemId: string,
): Promise<{ total: number; count: number }> {
  const result = await client.query<{ total: string; count: string }>(
    `SELECT COALESCE(SUM(refund_amount), 0)::text AS total,
            COUNT(*)::text AS count
       FROM reconciliation_refund_allocations
      WHERE organization_id = $1
        AND parent_item_id = $2
        AND status = 'applied'`,
    [organizationId, parentItemId],
  );
  return {
    total: Number(result.rows[0].total),
    count: Number(result.rows[0].count),
  };
}

// Stamp `refund_offset_recognized` on the parent capture, rewriting its
// summary with the refund context. The IS DISTINCT FROM guard on
// payout_sum_mismatch enforces the precedence rule: group-level wins
// over refund-level wins over per-item codes.
export async function stampRefundOffsetRecognized(
  client: PoolClient,
  input: {
    organizationId: string;
    parentItemId: string;
    summary: string;
  },
): Promise<{ stamped: boolean }> {
  const result = await client.query(
    `UPDATE reconciliation_items
        SET reason_code = 'refund_offset_recognized',
            summary = $3
      WHERE id = $1 AND organization_id = $2
        AND reason_code IS DISTINCT FROM 'payout_sum_mismatch'`,
    [input.parentItemId, input.organizationId, input.summary],
  );
  return { stamped: (result.rowCount ?? 0) > 0 };
}

// Convenience read for tests + future UI surfaces.
export async function listAllocationsForParent(
  client: PoolClient,
  organizationId: string,
  parentItemId: string,
): Promise<RefundAllocation[]> {
  const result = await client.query<{
    id: string;
    parent_item_id: string;
    parent_run_id: string;
    refund_source_run_id: string;
    refund_external_reference: string;
    refund_order_id: string;
    refund_amount: string;
    refund_transaction_at: Date | null;
    refund_settlement_at: Date | null;
    refund_utr: string | null;
    refund_statement_reference: string | null;
    status: RefundAllocationStatus;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, parent_item_id, parent_run_id, refund_source_run_id,
            refund_external_reference, refund_order_id,
            refund_amount::text AS refund_amount,
            refund_transaction_at, refund_settlement_at,
            refund_utr, refund_statement_reference,
            status, created_at, updated_at
       FROM reconciliation_refund_allocations
      WHERE organization_id = $1 AND parent_item_id = $2
      ORDER BY created_at ASC`,
    [organizationId, parentItemId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    parentItemId: row.parent_item_id,
    parentRunId: row.parent_run_id,
    refundSourceRunId: row.refund_source_run_id,
    refundExternalReference: row.refund_external_reference,
    refundOrderId: row.refund_order_id,
    refundAmount: Number(row.refund_amount),
    refundTransactionAt: row.refund_transaction_at?.toISOString() ?? null,
    refundSettlementAt: row.refund_settlement_at?.toISOString() ?? null,
    refundUtr: row.refund_utr,
    refundStatementReference: row.refund_statement_reference,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }));
}

// Deterministic fallback when the adapter doesn't supply a refund
// `gatewayReference`. Hash is stable across calls so re-running the
// refresh on the same refund row hits the UNIQUE constraint and is a
// no-op.
export function deriveRefundExternalReference(input: {
  orderId: string;
  amount: number;
  settlementAt: string | null;
}): string {
  const seed = `${input.orderId}|${input.amount.toFixed(2)}|${input.settlementAt ?? ""}`;
  const digest = createHash("sha256").update(seed).digest("hex").slice(0, 16);
  return `derived-refund-${digest}`;
}
