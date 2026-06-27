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
};
