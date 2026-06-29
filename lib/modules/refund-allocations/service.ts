import type { PoolClient } from "pg";
import { recordAuditEvent } from "@/lib/modules/audit/repository";
import type { NormalizedRefundRow } from "@/lib/types";
import {
  deriveRefundExternalReference,
  findParentCaptureForRefund,
  insertRefundAllocation,
  stampRefundOffsetRecognized,
  sumAppliedAllocationsForParent,
} from "./repository";
import type {
  RefundAllocationRefreshResult,
  RefundAllocationRefreshTrigger,
} from "./types";

// Slice 5 (Matching Engine v2): refund netting in the matching engine.
//
// Real Indian aggregators emit refund settlement rows as separate
// negative-amount lines keyed to the original Order ID, deducted from
// subsequent settlement batches. The engine writes a parent capture row
// to reconciliation_items; this post-persist hook links the refund row
// to its parent via reconciliation_refund_allocations and flips the
// parent's reason code to `refund_offset_recognized` when the effective
// variance (engine settled + sum of allocated refunds - expected net)
// lands within ₹0.01.
//
// Architectural notes:
// - The engine's `variance` column is preserved as the immutable
//   verdict. Mirrors immutable-ledger best practice ("append correcting
//   entries, don't update payment amounts").
// - The parent lookup is org-scoped (NOT run-scoped) so cross-run
//   linkage works: a capture in run A can be netted by a refund in
//   run B weeks later.
// - Idempotent via the partial unique index on
//   (organization_id, refund_external_reference, parent_item_id).
//   Re-running the refresh on the same candidate is a no-op.
// - Multi-refund partial: the hook re-evaluates effective variance
//   after EVERY allocation insert, so the second of two ₹300 refunds
//   against a ₹1000 capture triggers the stamp.
// - Over-refund (effective overshoots tolerance) leaves the parent at
//   `amount_mismatch` so the analyst sees it.
// - Precedence: leaves payout_sum_mismatch alone (group-level wins).
//   refreshReasonCodesForOrders' guard refuses to overwrite
//   refund_offset_recognized.
// - Manual override (Slice 3) is orthogonal — it operates on a
//   different column.

const TOLERANCE_RUPEES = 0.01;

export async function refreshRefundAllocations(
  client: PoolClient,
  organizationId: string,
  candidates: NormalizedRefundRow[],
  trigger: RefundAllocationRefreshTrigger,
  actor: { id: string | null; name: string },
  currentRunId?: string,
): Promise<RefundAllocationRefreshResult> {
  if (candidates.length === 0) {
    return {
      candidatesEvaluated: 0,
      allocationsApplied: 0,
      itemsFlagged: 0,
      orphanRefunds: 0,
    };
  }

  let candidatesEvaluated = 0;
  let allocationsApplied = 0;
  let itemsFlagged = 0;
  let orphanRefunds = 0;

  for (const candidate of candidates) {
    candidatesEvaluated += 1;
    if (!candidate.orderId || candidate.amount <= 0) {
      orphanRefunds += 1;
      continue;
    }

    const parent = await findParentCaptureForRefund(
      client,
      organizationId,
      candidate.orderId,
    );
    if (!parent) {
      orphanRefunds += 1;
      continue;
    }

    const externalReference =
      candidate.reference
      || deriveRefundExternalReference({
        orderId: candidate.orderId,
        amount: candidate.amount,
        settlementAt: candidate.settlementAt,
      });

    const { inserted } = await insertRefundAllocation(client, {
      organizationId,
      parentItemId: parent.id,
      parentRunId: parent.runId,
      refundSourceRunId: currentRunId ?? parent.runId,
      refundExternalReference: externalReference,
      refundOrderId: candidate.orderId,
      refundAmount: candidate.amount,
      refundTransactionAt: candidate.transactionAt,
      refundSettlementAt: candidate.settlementAt,
      refundUtr: candidate.utr,
      refundStatementReference: candidate.statementReference,
    });
    if (inserted) allocationsApplied += 1;

    // Recompute regardless of whether THIS insert was new — idempotent
    // re-runs should still confirm the parent's reason code.
    const { total, count } = await sumAppliedAllocationsForParent(
      client,
      organizationId,
      parent.id,
    );
    if (parent.settledAmount === null || parent.expectedNet === null) {
      continue;
    }
    const effectiveSettled = round(parent.settledAmount + total);
    const effectiveVariance = round(effectiveSettled - parent.expectedNet);

    if (Math.abs(effectiveVariance) > TOLERANCE_RUPEES) continue;

    const summary =
      `Capture ₹${parent.settledAmount.toFixed(2)} offset by refund(s)`
      + ` ₹${total.toFixed(2)} → effective net ₹${effectiveSettled.toFixed(2)},`
      + ` ties to gateway expected ₹${parent.expectedNet.toFixed(2)}.`
      + ` ${count} refund allocation(s) recognized.`;

    const { stamped } = await stampRefundOffsetRecognized(client, {
      organizationId,
      parentItemId: parent.id,
      summary,
    });
    if (stamped) itemsFlagged += 1;
  }

  const result: RefundAllocationRefreshResult = {
    candidatesEvaluated,
    allocationsApplied,
    itemsFlagged,
    orphanRefunds,
  };

  await recordAuditEvent(
    {
      organizationId,
      actorUserId: actor.id,
      actorName: actor.name,
      action: "reason_code.refund_allocations_recomputed",
      entityType: "organization",
      entityId: organizationId,
      details: { trigger, ...result },
    },
    client,
  );

  return result;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
