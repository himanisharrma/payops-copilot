import type { PoolClient } from "pg";
import type {
  ReasonCode,
  ReconciliationItem,
  ReconciliationStatus,
  SettlementTimingStatus,
} from "@/lib/types";
import type {
  NormalizedGatewayRow,
  NormalizedSettlementRow,
} from "./strategies";
import { recordAuditEvent } from "@/lib/modules/audit/repository";

// Tolerance for fee_mismatch / gst_mismatch detection: variance must align with
// the gateway-reported fee or tax within ±1 rupee to assign the code.
const VARIANCE_ALIGNMENT_RUPEES = 1;

function nearAmount(a: number, b: number): boolean {
  return Math.abs(Math.abs(a) - Math.abs(b)) <= VARIANCE_ALIGNMENT_RUPEES;
}

// In-engine classifier: runs synchronously inside reconcilePayments(), using
// only the data already passed to the engine. Never returns a cross-table code
// (utr_duplicate, hold_unexplained, payout_failed, chargeback_pending_recovery,
// refund_not_adjusted) — those require joining merchant_settlement_batches or
// payment_workflows and are populated later by classifyWithContext().
export function classifyInEngine(input: {
  status: ReconciliationStatus;
  settlementStatus: SettlementTimingStatus;
  gateway: NormalizedGatewayRow | null;
  settlement: NormalizedSettlementRow | null;
  variance: number;
}): ReasonCode | null {
  const { status, settlementStatus, gateway, settlement, variance } = input;

  // Matched items with a missing UTR are flagged for traceability even though
  // amounts agree — the row can't be tied to a bank credit later.
  if (status === "matched" && settlement && !settlement.utr) {
    return "utr_missing";
  }

  // Otherwise clean matches need no diagnosis.
  if (status === "matched") {
    return null;
  }

  if (status === "missing_settlement" && settlementStatus === "not_due") {
    return "timing_not_due";
  }

  if (status === "amount_mismatch" && gateway) {
    if (gateway.fee > 0 && nearAmount(variance, gateway.fee)) {
      return "fee_mismatch";
    }
    if (gateway.tax > 0 && nearAmount(variance, gateway.tax)) {
      return "gst_mismatch";
    }
  }

  if (settlement && !settlement.utr) {
    return "utr_missing";
  }

  return "unmatched_other";
}

// Cross-table context loaded by the backfill script and (later, in Slice 2b)
// the merchant-settlements / payment-workflows service hooks. Shapes are
// intentionally loose — both modules already expose richer typed shapes; we
// only consume the few fields the classifier needs, so the classifier can be
// unit-tested with plain fixtures.
export type ReasonCodeContext = {
  merchantSettlementBatches: Array<{
    utr: string | null;
    status: string;
  }>;
  duplicateUtrFlags: Set<string>;
  paymentWorkflows: Array<{
    type: "refund" | "chargeback";
    status: string;
  }>;
};

const CHARGEBACK_OPEN_STATUSES = new Set([
  "received",
  "evidence_due",
  "evidence_submitted",
]);
const REFUND_OPEN_STATUSES = new Set(["requested", "approved", "processing"]);
const HELD_BATCH_STATUSES = new Set(["held", "credited_held"]);
const FAILED_BATCH_STATUSES = new Set(["failed", "payout_failed"]);

// Cross-table classifier: runs against context loaded from merchant settlement
// batches and payment workflows for the same (organization_id, order_id).
// Returns null when no cross-table code applies — caller should keep the
// existing in-engine code.
export function classifyWithContext(
  status: ReconciliationStatus,
  ctx: ReasonCodeContext,
): ReasonCode | null {
  for (const batch of ctx.merchantSettlementBatches) {
    if (batch.utr && ctx.duplicateUtrFlags.has(batch.utr)) {
      return "utr_duplicate";
    }
  }

  for (const batch of ctx.merchantSettlementBatches) {
    if (FAILED_BATCH_STATUSES.has(batch.status)) {
      return "payout_failed";
    }
  }

  for (const batch of ctx.merchantSettlementBatches) {
    if (HELD_BATCH_STATUSES.has(batch.status)) {
      return "hold_unexplained";
    }
  }

  for (const workflow of ctx.paymentWorkflows) {
    if (
      workflow.type === "chargeback" &&
      CHARGEBACK_OPEN_STATUSES.has(workflow.status)
    ) {
      return "chargeback_pending_recovery";
    }
  }

  if (status === "amount_mismatch" || status === "missing_settlement") {
    for (const workflow of ctx.paymentWorkflows) {
      if (
        workflow.type === "refund" &&
        REFUND_OPEN_STATUSES.has(workflow.status)
      ) {
        return "refund_not_adjusted";
      }
    }
  }

  return null;
}

// Refines a ReconciliationItem's reason code by combining the existing
// (in-engine) code with what classifyWithContext would assign. Cross-table
// codes win when present.
export function refineReasonCode(
  item: Pick<ReconciliationItem, "reasonCode" | "status">,
  ctx: ReasonCodeContext,
): ReasonCode | null {
  const crossTable = classifyWithContext(item.status, ctx);
  return crossTable ?? item.reasonCode;
}

// Policy metadata: per-code exposure tier, owner default, SLA hours, allowed
// actions, evidence requirement, auto-close condition, and escalation path.
// Used by future UI surfaces (cases / insights / root-causes) and by the
// remediation-programs module when it learns to cluster on reason codes.
//
// Values are best-effort synthetic defaults reflecting common Indian merchant
// finance / payment-ops practice. Per the "no governance surfaces yet"
// guardrail in CLAUDE.md, they are not admin-editable; a future slice can add
// a reason_code_definitions table that overrides these.
export type ReasonCodePolicy = {
  exposureTier: "informational" | "low" | "medium" | "high";
  ownerDefault: "finance" | "settlement_ops" | "support" | "risk" | "treasury";
  slaHours: number;
  allowedActions: Array<
    | "auto_close"
    | "manual_match"
    | "raise_to_provider"
    | "raise_to_bank"
    | "write_off"
  >;
  evidenceRequired: string[];
  autoCloseWhen: string | null;
  escalationPath: string;
};

export const REASON_CODE_POLICY: Record<ReasonCode, ReasonCodePolicy> = {
  timing_not_due: {
    exposureTier: "informational",
    ownerDefault: "settlement_ops",
    slaHours: 72,
    allowedActions: ["auto_close"],
    evidenceRequired: ["settlement_policy_version", "expected_settlement_at"],
    autoCloseWhen: "settlement_recorded_at IS NOT NULL",
    escalationPath: "none",
  },
  utr_missing: {
    exposureTier: "low",
    ownerDefault: "settlement_ops",
    slaHours: 24,
    allowedActions: ["manual_match", "raise_to_provider"],
    evidenceRequired: ["settlement_row", "expected_utr"],
    autoCloseWhen: "settlement.utr IS NOT NULL",
    escalationPath: "provider_settlement_support",
  },
  utr_duplicate: {
    exposureTier: "high",
    ownerDefault: "treasury",
    slaHours: 4,
    allowedActions: ["raise_to_provider", "raise_to_bank"],
    evidenceRequired: [
      "merchant_settlement_batch_a",
      "merchant_settlement_batch_b",
    ],
    autoCloseWhen: null,
    escalationPath: "provider_treasury_dispute",
  },
  fee_mismatch: {
    exposureTier: "medium",
    ownerDefault: "finance",
    slaHours: 24,
    allowedActions: ["raise_to_provider", "write_off"],
    evidenceRequired: [
      "gateway_fee",
      "settled_amount",
      "fee_schedule_version",
    ],
    autoCloseWhen: "abs(variance) <= 0.01",
    escalationPath: "provider_billing",
  },
  gst_mismatch: {
    exposureTier: "medium",
    ownerDefault: "finance",
    slaHours: 24,
    allowedActions: ["raise_to_provider", "write_off"],
    evidenceRequired: ["gateway_tax", "settled_amount", "gst_rate"],
    autoCloseWhen: "abs(variance) <= 0.01",
    escalationPath: "provider_billing",
  },
  hold_unexplained: {
    exposureTier: "high",
    ownerDefault: "risk",
    slaHours: 4,
    allowedActions: ["raise_to_provider"],
    evidenceRequired: ["merchant_settlement_batch", "hold_reason"],
    autoCloseWhen: "batch.status = 'credited'",
    escalationPath: "provider_risk_review",
  },
  payout_failed: {
    exposureTier: "high",
    ownerDefault: "settlement_ops",
    slaHours: 4,
    allowedActions: ["raise_to_provider", "raise_to_bank"],
    evidenceRequired: ["merchant_settlement_batch", "failure_reason"],
    autoCloseWhen: "batch.status = 'credited'",
    escalationPath: "provider_payout_ops",
  },
  chargeback_pending_recovery: {
    exposureTier: "high",
    ownerDefault: "risk",
    slaHours: 24,
    allowedActions: ["raise_to_provider"],
    evidenceRequired: ["payment_workflow", "evidence_checklist"],
    autoCloseWhen: "workflow.status IN ('won', 'lost', 'accepted')",
    escalationPath: "chargeback_team",
  },
  refund_not_adjusted: {
    exposureTier: "medium",
    ownerDefault: "support",
    slaHours: 24,
    allowedActions: ["manual_match", "raise_to_provider"],
    evidenceRequired: ["payment_workflow", "expected_adjustment"],
    autoCloseWhen: "workflow.status = 'completed'",
    escalationPath: "support_refund_ops",
  },
  unmatched_other: {
    exposureTier: "medium",
    ownerDefault: "settlement_ops",
    slaHours: 24,
    allowedActions: ["manual_match", "raise_to_provider", "write_off"],
    evidenceRequired: ["all_three_files"],
    autoCloseWhen: null,
    escalationPath: "manual_review",
  },
  // Slice 4 (Matching Engine v2): group-level verdict applied by
  // refreshPayoutSumChecks when sum(items.settled_amount) for a payout group
  // diverges from the actual bank credit amount. Takes precedence over
  // per-item codes — refreshReasonCodesForOrders must NOT overwrite this
  // code (see the IS DISTINCT FROM guard on its UPDATE).
  payout_sum_mismatch: {
    exposureTier: "high",
    ownerDefault: "treasury",
    slaHours: 8,
    allowedActions: ["raise_to_provider", "raise_to_bank"],
    evidenceRequired: [
      "merchant_settlement_batch",
      "merchant_settlement_bank_credits",
      "sum_of_settled_amount",
    ],
    autoCloseWhen: null,
    escalationPath: "provider_settlement_ops",
  },
};

// Service-layer hook: re-runs classifyWithContext against current
// merchant_settlement_batches and payment_workflows for the given order_ids
// and UPDATEs reason_code on any reconciliation_items whose code would change.
// Caller passes its own transaction client so the refresh is atomic with the
// originating mutation. Emits a single audit event summarizing the recompute.
//
// SQL queries here MUST keep classifyWithContext's tier order in lockstep —
// the scripts/backfill-reason-codes.mjs SQL is the same logic in raw form.
export type ReasonCodeRefreshTrigger =
  | "merchant_settlement_status_changed"
  | "payment_workflow_status_changed";

export async function refreshReasonCodesForOrders(
  client: PoolClient,
  organizationId: string,
  orderIds: string[],
  trigger: ReasonCodeRefreshTrigger,
  actor: { id: string | null; name: string },
): Promise<{ changed: number }> {
  if (orderIds.length === 0) return { changed: 0 };
  const uniqueOrderIds = Array.from(new Set(orderIds));

  const items = await client.query<{
    id: string;
    order_id: string;
    reconciliation_status: ReconciliationStatus;
    reason_code: ReasonCode | null;
  }>(
    `SELECT id, order_id, reconciliation_status, reason_code
       FROM reconciliation_items
      WHERE organization_id = $1 AND order_id = ANY($2::text[])`,
    [organizationId, uniqueOrderIds],
  );
  if (items.rowCount === 0) return { changed: 0 };

  const batches = await client.query<{
    order_id: string;
    utr: string | null;
    status: string;
  }>(
    `SELECT l.order_id, b.utr, b.status
       FROM merchant_settlement_lines l
       JOIN merchant_settlement_batches b ON b.id = l.batch_id
      WHERE l.organization_id = $1 AND l.order_id = ANY($2::text[])`,
    [organizationId, uniqueOrderIds],
  );

  const workflows = await client.query<{
    order_id: string;
    workflow_type: "refund" | "chargeback";
    status: string;
  }>(
    `SELECT order_id, workflow_type, status
       FROM payment_workflows
      WHERE organization_id = $1 AND order_id = ANY($2::text[])`,
    [organizationId, uniqueOrderIds],
  );

  // duplicate_utr is org-wide: any UTR that appears on more than one batch
  // (not just within the touched order_ids) is flagged.
  const utrCounts = await client.query<{ utr: string; count: string }>(
    `SELECT utr, COUNT(*)::text AS count FROM merchant_settlement_batches
      WHERE organization_id = $1 AND utr IS NOT NULL
      GROUP BY utr HAVING COUNT(*) > 1`,
    [organizationId],
  );
  const duplicateUtrFlags = new Set(utrCounts.rows.map((r) => r.utr));

  const batchesByOrder = new Map<string, Array<{ utr: string | null; status: string }>>();
  for (const row of batches.rows) {
    const arr = batchesByOrder.get(row.order_id) ?? [];
    arr.push({ utr: row.utr, status: row.status });
    batchesByOrder.set(row.order_id, arr);
  }
  const workflowsByOrder = new Map<
    string,
    Array<{ type: "refund" | "chargeback"; status: string }>
  >();
  for (const row of workflows.rows) {
    const arr = workflowsByOrder.get(row.order_id) ?? [];
    arr.push({ type: row.workflow_type, status: row.status });
    workflowsByOrder.set(row.order_id, arr);
  }

  let changed = 0;
  for (const item of items.rows) {
    const ctx: ReasonCodeContext = {
      merchantSettlementBatches: batchesByOrder.get(item.order_id) ?? [],
      duplicateUtrFlags,
      paymentWorkflows: workflowsByOrder.get(item.order_id) ?? [],
    };
    const next = classifyWithContext(item.reconciliation_status, ctx);
    if (next && next !== item.reason_code) {
      // Precedence: Slice 4's group-level payout_sum_mismatch wins over
      // per-item codes. Never overwrite it from this per-item refresh.
      const result = await client.query(
        `UPDATE reconciliation_items SET reason_code = $1
          WHERE id = $2 AND organization_id = $3
            AND reason_code IS DISTINCT FROM 'payout_sum_mismatch'`,
        [next, item.id, organizationId],
      );
      if (result.rowCount) changed += 1;
    }
  }

  await recordAuditEvent(
    {
      organizationId,
      actorUserId: actor.id,
      actorName: actor.name,
      action: "reason_code.recomputed",
      entityType: "organization",
      entityId: organizationId,
      details: {
        trigger,
        orderIds: uniqueOrderIds,
        itemsExamined: items.rowCount,
        changed,
      },
    },
    client,
  );

  return { changed };
}

// Slice 4 (Matching Engine v2): many-to-one payout sum check.
//
// One bank credit / one UTR / one provider statement_reference aggregates many
// payment items. After items are persisted, this hook verifies that
// sum(items.settled_amount) for each payout group ties to the actual bank
// credit total in merchant_settlement_bank_credits. On mismatch, every
// settled item in the group is flagged `payout_sum_mismatch` and its summary
// text rewritten to give the analyst sibling-item context without a new UI
// surface.
//
// Architectural notes:
// - Items are joined by (organization_id, payout_id), NOT by run_id. Payout
//   groups can span multiple reconciliation runs (re-import scenarios).
// - NULL settled_amount items (gateway_missing, pending, missing_settlement)
//   are excluded from the sum AND not flagged — they have no money to
//   contribute.
// - Missing batch row OR missing bank-credit row(s) → defer silently. The
//   check re-fires when settlement-imports lands the data via
//   refreshMerchantSettlements.
// - Bank credits fan out per batch (no UNIQUE on batch_id), so the sum is
//   `SUM(amount) GROUP BY batch_id`.
// - Manual override layer (Slice 3) is orthogonal: manual_match / unmatch
//   does not change settled_amount, so the sum check is unaffected by
//   override state.
// - Precedence: payout_sum_mismatch wins over per-item codes. This function
//   overwrites unconditionally on mismatch; refreshReasonCodesForOrders
//   refuses to overwrite payout_sum_mismatch (see IS DISTINCT FROM guard
//   above).
export type PayoutSumRefreshTrigger =
  | "reconciliation_run_persisted"
  | "merchant_settlement_refresh";

export type PayoutSumRefreshResult = {
  groupsChecked: number;
  groupsMismatched: number;
  groupsDeferred: number;
  itemsFlagged: number;
  itemsCleared: number;
};

const PAYOUT_SUM_TOLERANCE_RUPEES = 0.01;

export async function refreshPayoutSumChecks(
  client: PoolClient,
  organizationId: string,
  payoutIds: string[],
  trigger: PayoutSumRefreshTrigger,
  actor: { id: string | null; name: string },
): Promise<PayoutSumRefreshResult> {
  if (payoutIds.length === 0) {
    return {
      groupsChecked: 0,
      groupsMismatched: 0,
      groupsDeferred: 0,
      itemsFlagged: 0,
      itemsCleared: 0,
    };
  }
  const uniquePayoutIds = Array.from(new Set(payoutIds));

  // FOR UPDATE serializes concurrent refreshes on the same payout group.
  const items = await client.query<{
    id: string;
    payout_id: string;
    reason_code: ReasonCode | null;
    settled_amount: string | null;
  }>(
    `SELECT id, payout_id, reason_code, settled_amount::text
       FROM reconciliation_items
      WHERE organization_id = $1
        AND payout_id = ANY($2::text[])
      FOR UPDATE`,
    [organizationId, uniquePayoutIds],
  );

  const batches = await client.query<{
    id: string;
    statement_reference: string;
  }>(
    `SELECT id, statement_reference
       FROM merchant_settlement_batches
      WHERE organization_id = $1
        AND statement_reference = ANY($2::text[])`,
    [organizationId, uniquePayoutIds],
  );
  const batchByPayoutId = new Map<string, string>();
  for (const row of batches.rows) {
    batchByPayoutId.set(row.statement_reference, row.id);
  }

  const batchIds = Array.from(batchByPayoutId.values());
  const credits = batchIds.length
    ? await client.query<{ batch_id: string; credited: string }>(
        `SELECT batch_id, SUM(amount)::text AS credited
           FROM merchant_settlement_bank_credits
          WHERE organization_id = $1 AND batch_id = ANY($2::uuid[])
          GROUP BY batch_id`,
        [organizationId, batchIds],
      )
    : { rows: [] as Array<{ batch_id: string; credited: string }> };
  const creditByBatchId = new Map<string, number>();
  for (const row of credits.rows) {
    creditByBatchId.set(row.batch_id, Number(row.credited));
  }

  const itemsByPayout = new Map<
    string,
    Array<{
      id: string;
      reasonCode: ReasonCode | null;
      settledAmount: number | null;
    }>
  >();
  for (const row of items.rows) {
    const arr = itemsByPayout.get(row.payout_id) ?? [];
    arr.push({
      id: row.id,
      reasonCode: row.reason_code,
      settledAmount: row.settled_amount === null ? null : Number(row.settled_amount),
    });
    itemsByPayout.set(row.payout_id, arr);
  }

  let groupsChecked = 0;
  let groupsMismatched = 0;
  let groupsDeferred = 0;
  let itemsFlagged = 0;
  let itemsCleared = 0;

  for (const payoutId of uniquePayoutIds) {
    const group = itemsByPayout.get(payoutId) ?? [];
    if (group.length === 0) continue;
    const batchId = batchByPayoutId.get(payoutId);
    if (!batchId) {
      groupsDeferred += 1;
      continue;
    }
    const credited = creditByBatchId.get(batchId);
    if (credited === undefined) {
      groupsDeferred += 1;
      continue;
    }
    groupsChecked += 1;
    const settledItems = group.filter((i) => i.settledAmount !== null);
    const sum =
      Math.round(
        settledItems.reduce((acc, i) => acc + (i.settledAmount ?? 0), 0) * 100,
      ) / 100;
    const variance = Math.round((sum - credited) * 100) / 100;

    if (Math.abs(variance) <= PAYOUT_SUM_TOLERANCE_RUPEES) {
      // Group sums correctly. Clear any prior payout_sum_mismatch flags so
      // refreshReasonCodesForOrders can re-stamp the right per-item code.
      for (const item of group) {
        if (item.reasonCode === "payout_sum_mismatch") {
          const result = await client.query(
            `UPDATE reconciliation_items SET reason_code = NULL
              WHERE id = $1 AND organization_id = $2
                AND reason_code = 'payout_sum_mismatch'`,
            [item.id, organizationId],
          );
          if (result.rowCount) itemsCleared += 1;
        }
      }
      continue;
    }

    groupsMismatched += 1;
    const summary =
      `Part of payout ${payoutId} — ${settledItems.length} items totalling ` +
      `₹${sum.toFixed(2)} against bank credit of ₹${credited.toFixed(2)}. ` +
      `Variance ₹${variance.toFixed(2)}.`;
    for (const item of settledItems) {
      const result = await client.query(
        `UPDATE reconciliation_items
            SET reason_code = 'payout_sum_mismatch',
                summary = $3
          WHERE id = $1 AND organization_id = $2`,
        [item.id, organizationId, summary],
      );
      if (result.rowCount) itemsFlagged += 1;
    }
  }

  const result: PayoutSumRefreshResult = {
    groupsChecked,
    groupsMismatched,
    groupsDeferred,
    itemsFlagged,
    itemsCleared,
  };

  await recordAuditEvent(
    {
      organizationId,
      actorUserId: actor.id,
      actorName: actor.name,
      action: "reason_code.payout_sum_recomputed",
      entityType: "organization",
      entityId: organizationId,
      details: { trigger, payoutIds: uniquePayoutIds, ...result },
    },
    client,
  );

  return result;
}
