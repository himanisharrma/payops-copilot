import { createHash } from "node:crypto";
import type {
  AccountRole,
  CaptureSource,
  EntryDirection,
  ProviderId,
  RefundAllocationSource,
  SettlementBankCreditInput,
  SettlementDeductionInput,
  SourceType,
} from "./types";

// Pure functions that translate a source event into a balanced
// { transaction, entries[] } plan. No DB, fully unit-testable. The
// service layer maps `accountRole` + `provider` to a concrete
// `account_id` after looking up ledger_accounts, then inserts.
//
// Invariant per plan: Σ debit amounts === Σ credit amounts (verified
// in `assertBalanced`). The DB-level append-only trigger plus the
// service-layer guard form defence-in-depth.

export type EntryPlan = {
  accountRole: AccountRole;
  provider: ProviderId | null;
  direction: EntryDirection;
  amount: number;
};

export type TransactionPlan = {
  sourceType: SourceType;
  sourceId: string | null;
  sourceBatchId: string | null;
  externalRefs: Record<string, unknown>;
  effectiveAt: Date;
  idempotencyKey: string;
  description: string;
  entries: EntryPlan[];
};

const toCents = (rupees: number) => Math.round(rupees * 100);

export function captureToPlan(input: CaptureSource): TransactionPlan {
  return {
    sourceType: "capture",
    sourceId: input.sourceItemId,
    sourceBatchId: null,
    externalRefs: {
      orderId: input.externalRefs.orderId,
      gatewayReference: input.externalRefs.gatewayReference,
      provider: input.provider,
    },
    effectiveAt: input.effectiveAt,
    idempotencyKey: `capture:${input.sourceItemId}`,
    description: `Capture ₹${input.grossAmount.toFixed(2)} via ${input.provider}`,
    entries: [
      {
        accountRole: "provider_receivable",
        provider: input.provider,
        direction: "debit",
        amount: input.grossAmount,
      },
      {
        accountRole: "merchant_payable",
        provider: null,
        direction: "credit",
        amount: input.grossAmount,
      },
    ],
  };
}

export function feeToPlan(input: {
  deduction: SettlementDeductionInput;
  batchId: string;
  provider: ProviderId;
  effectiveAt: Date;
  utr: string | null;
}): TransactionPlan {
  const { deduction, batchId, provider, effectiveAt, utr } = input;
  return {
    sourceType: "fee",
    sourceId: deduction.sourceDeductionId,
    sourceBatchId: batchId,
    externalRefs: {
      deductionType: deduction.type,
      provider,
      utr,
    },
    effectiveAt,
    // Amount is part of the key so a re-refreshed batch with a changed
    // amount produces a NEW transaction. v1.1 will add explicit
    // reverseTransaction calls from the settlement service; until then
    // this prevents silent ledger drift on mutation.
    idempotencyKey: `fee:${deduction.sourceDeductionId}:${deduction.amount.toFixed(2)}`,
    description: `${deduction.type.toUpperCase()} ₹${deduction.amount.toFixed(2)} via ${provider}`,
    entries: [
      {
        accountRole: "fee_expense",
        provider,
        direction: "debit",
        amount: deduction.amount,
      },
      {
        accountRole: "provider_receivable",
        provider,
        direction: "credit",
        amount: deduction.amount,
      },
    ],
  };
}

export function gstToPlan(input: {
  deduction: SettlementDeductionInput;
  batchId: string;
  provider: ProviderId;
  effectiveAt: Date;
  utr: string | null;
}): TransactionPlan {
  const { deduction, batchId, provider, effectiveAt, utr } = input;
  return {
    sourceType: "gst",
    sourceId: deduction.sourceDeductionId,
    sourceBatchId: batchId,
    externalRefs: { deductionType: deduction.type, provider, utr },
    effectiveAt,
    idempotencyKey: `gst:${deduction.sourceDeductionId}:${deduction.amount.toFixed(2)}`,
    description: `GST ₹${deduction.amount.toFixed(2)} on ${provider} settlement`,
    entries: [
      {
        accountRole: "gst_liability",
        provider: null,
        direction: "debit",
        amount: deduction.amount,
      },
      {
        accountRole: "provider_receivable",
        provider,
        direction: "credit",
        amount: deduction.amount,
      },
    ],
  };
}

export function bankCreditToPlan(input: {
  credit: SettlementBankCreditInput;
  batchId: string;
  provider: ProviderId;
  utr: string | null;
}): TransactionPlan {
  const { credit, batchId, provider, utr } = input;
  return {
    sourceType: "bank_credit",
    sourceId: credit.sourceBankCreditId,
    sourceBatchId: batchId,
    externalRefs: { utr, provider },
    effectiveAt: credit.creditedAt,
    idempotencyKey: `bank_credit:${credit.sourceBankCreditId}:${credit.amount.toFixed(2)}`,
    description: `Bank credit ₹${credit.amount.toFixed(2)} (UTR ${utr ?? "n/a"})`,
    entries: [
      {
        accountRole: "escrow_cash",
        provider: null,
        direction: "debit",
        amount: credit.amount,
      },
      {
        accountRole: "provider_receivable",
        provider,
        direction: "credit",
        amount: credit.amount,
      },
    ],
  };
}

export function payoutToPlan(input: {
  batchId: string;
  amount: number;
  provider: ProviderId;
  effectiveAt: Date;
  utr: string | null;
}): TransactionPlan {
  const { batchId, amount, provider, effectiveAt, utr } = input;
  return {
    sourceType: "payout",
    sourceId: batchId,
    sourceBatchId: batchId,
    externalRefs: { utr, provider },
    effectiveAt,
    idempotencyKey: `payout:${batchId}:${amount.toFixed(2)}`,
    description: `Payout ₹${amount.toFixed(2)} to merchant (UTR ${utr ?? "n/a"})`,
    entries: [
      {
        accountRole: "merchant_payable",
        provider: null,
        direction: "debit",
        amount,
      },
      {
        accountRole: "escrow_cash",
        provider: null,
        direction: "credit",
        amount,
      },
    ],
  };
}

// v1 collapses refund initiation + netting into a single transaction
// because we only see the refund at settlement time (refund_allocations
// is the post-netting evidence). The economic effect: PG paid the
// customer back from our settlement pot, so (a) we owe the merchant
// less, (b) PG owes us less. refund_payable stays unused in v1; v1.1
// will add a separate `refund_initiation` source_type that posts
// CR refund_payable + DR merchant_payable when the refund is opened,
// and refund_netting then posts DR refund_payable + CR provider_receivable.
export function refundNettingToPlan(
  input: RefundAllocationSource,
): TransactionPlan {
  return {
    sourceType: "refund_netting",
    sourceId: input.allocationId,
    sourceBatchId: null,
    externalRefs: {
      refundOrderId: input.externalRefs.refundOrderId,
      refundExternalReference: input.externalRefs.refundExternalReference,
      provider: input.provider,
    },
    effectiveAt: input.effectiveAt,
    idempotencyKey: `refund_netting:${input.allocationId}`,
    description: `Refund ₹${input.amount.toFixed(2)} netted against capture`,
    entries: [
      {
        accountRole: "merchant_payable",
        provider: null,
        direction: "debit",
        amount: input.amount,
      },
      {
        accountRole: "provider_receivable",
        provider: input.provider,
        direction: "credit",
        amount: input.amount,
      },
    ],
  };
}

// Stable hash for a description suffix when callers want a reproducible
// label. Not currently used by any recipe but kept as a utility for
// future recipes (e.g., adjustments).
export function recipeHashSuffix(seed: string): string {
  return createHash("sha256").update(seed).digest("hex").slice(0, 8);
}

// Guard run at the service layer before INSERT — every transaction
// plan must have balanced entries in cents-precision integer math
// (rupees * 100 to avoid float drift).
export function assertBalanced(plan: TransactionPlan): void {
  if (plan.entries.length < 2) {
    throw new Error(
      `ledger_unbalanced: transaction needs >=2 entries, got ${plan.entries.length}`,
    );
  }
  let debit = 0;
  let credit = 0;
  for (const entry of plan.entries) {
    if (entry.amount <= 0) {
      throw new Error(
        `ledger_unbalanced: entry amount must be > 0, got ${entry.amount}`,
      );
    }
    if (entry.direction === "debit") debit += toCents(entry.amount);
    else credit += toCents(entry.amount);
  }
  if (debit !== credit) {
    throw new Error(
      `ledger_unbalanced: Σdebit=${debit / 100}, Σcredit=${credit / 100}`,
    );
  }
}

