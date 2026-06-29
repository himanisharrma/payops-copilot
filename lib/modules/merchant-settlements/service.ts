import type { Actor } from "@/lib/access";
import { transaction } from "@/lib/db";
import { recordAuditEvent } from "@/lib/modules/audit/repository";
import { postSettlementEntries } from "@/lib/modules/ledger/service";
import {
  ensureDefaultMerchantAccount,
  getMerchantSettlement,
  listRefreshCandidates,
  listMerchantSettlements,
  loadSettlementSourceForLedger,
  lockMerchantSettlementRefresh,
  replaceSettlementChildren,
  buildStatementReference,
  loadRefundCandidatesForStatements,
  upsertSettlementBatch,
  type MerchantSettlementRefreshClock,
} from "@/lib/modules/merchant-settlements/repository";
import type {
  MerchantSettlementFilters,
  MerchantSettlementStatus,
  MerchantSettlementUtrStatus,
} from "@/lib/modules/merchant-settlements/types";
import { providerIds } from "@/lib/provider-adapters";
import {
  refreshPayoutSumChecks,
  refreshReasonCodesForOrders,
} from "@/lib/modules/reconciliation/reason-codes";
import { refreshRefundAllocations } from "@/lib/modules/refund-allocations/service";
import type { ProviderId } from "@/lib/types";

const settlementStatuses: Array<MerchantSettlementStatus | "all"> = [
  "all",
  "expected",
  "scheduled",
  "sent",
  "credited",
  "held",
  "failed",
  "partially_credited",
];

export type SettlementArithmeticInput = {
  grossAmounts: Array<number | string>;
  deductions: Array<number | string>;
  bankCredits?: Array<number | string>;
};

export type SettlementArithmeticResult = {
  grossAmount: number;
  deductionAmount: number;
  netAmount: number;
  bankCreditAmount: number;
  varianceAmount: number;
};

export type UtrClassificationInput = {
  status?: MerchantSettlementStatus;
  utr?: string | null;
  netAmount: number | string;
  bankCredits: Array<{ utr: string; amount: number | string }>;
  expectedSettlementAt: Date | string;
  actualSettlementAt?: Date | string | null;
  retryCount?: number;
  now?: Date;
};

export type UtrClassificationResult = {
  status: MerchantSettlementUtrStatus;
  settlementStatus: MerchantSettlementStatus;
  bankCreditAmount: number;
  varianceAmount: number;
  evidence: {
    reason: string;
    utrPresent: boolean;
    matchingCreditCount: number;
    totalCreditCount: number;
    expectedSettlementAt: string;
    evaluatedAt: string;
  };
};

export function calculateSettlementArithmetic(
  input: SettlementArithmeticInput,
): SettlementArithmeticResult {
  const grossCents = sumCents(input.grossAmounts);
  const deductionCents = sumCents(input.deductions);
  if (deductionCents > grossCents) {
    throw new Error("Settlement deductions cannot exceed gross amount.");
  }
  const netCents = grossCents - deductionCents;
  const bankCreditCents = sumCents(input.bankCredits ?? []);
  return {
    grossAmount: centsToMoney(grossCents),
    deductionAmount: centsToMoney(deductionCents),
    netAmount: centsToMoney(netCents),
    bankCreditAmount: centsToMoney(bankCreditCents),
    varianceAmount: centsToMoney(bankCreditCents - netCents),
  };
}

export function classifyUtr(input: UtrClassificationInput): UtrClassificationResult {
  const now = input.now ?? new Date();
  const expectedSettlementAt = coerceDate(input.expectedSettlementAt);
  const utr = input.utr?.trim() || null;
  const matchingCredits = utr
    ? input.bankCredits.filter((credit) => credit.utr.trim() === utr)
    : [];
  const allCreditCents = sumCents(input.bankCredits.map((credit) => credit.amount));
  const matchingCreditCents = sumCents(
    matchingCredits.map((credit) => credit.amount),
  );
  const netCents = moneyToCents(input.netAmount);
  const varianceCents = matchingCreditCents - netCents;

  let status: MerchantSettlementUtrStatus;
  let settlementStatus: MerchantSettlementStatus;
  let reason: string;

  if (input.status === "failed") {
    status = (input.retryCount ?? 0) >= 3 ? "retry_exhausted" : "failed_payout";
    settlementStatus = "failed";
    reason =
      status === "retry_exhausted"
        ? "The synthetic payout is failed after the retry threshold."
        : "The synthetic payout is marked failed.";
  } else if (input.status === "held") {
    status = "held_settlement";
    settlementStatus = "held";
    reason = "The settlement batch is explicitly held.";
  } else if (!utr) {
    status = "missing_utr";
    settlementStatus =
      now > expectedSettlementAt ? "partially_credited" : "scheduled";
    reason = "No UTR is recorded for this settlement batch.";
  } else if (matchingCredits.length > 1) {
    status = "duplicate_utr";
    settlementStatus = "partially_credited";
    reason = "More than one bank credit uses the same UTR.";
  } else if (matchingCredits.length === 0) {
    if (now <= expectedSettlementAt) {
      status = "not_due";
      settlementStatus = "scheduled";
      reason = "The expected settlement time has not passed.";
    } else {
      status = allCreditCents > 0 ? "utr_not_found" : "delayed_credit";
      settlementStatus = "partially_credited";
      reason =
        status === "utr_not_found"
          ? "Bank credits exist, but none match the settlement UTR."
          : "The settlement is past its expected time with no matching credit.";
    }
  } else if (varianceCents !== 0) {
    status = "amount_mismatch";
    settlementStatus = "partially_credited";
    reason = "The matching bank credit amount does not equal net settlement.";
  } else {
    status = "matched";
    settlementStatus = "credited";
    reason = "Exactly one bank credit matches the UTR and net amount.";
  }

  return {
    status,
    settlementStatus,
    bankCreditAmount: centsToMoney(matchingCreditCents),
    varianceAmount: centsToMoney(varianceCents),
    evidence: {
      reason,
      utrPresent: Boolean(utr),
      matchingCreditCount: matchingCredits.length,
      totalCreditCount: input.bankCredits.length,
      expectedSettlementAt: expectedSettlementAt.toISOString(),
      evaluatedAt: now.toISOString(),
    },
  };
}

export function parseMerchantSettlementFilters(
  params: URLSearchParams,
): MerchantSettlementFilters {
  const provider = params.get("provider");
  const status = params.get("status");
  return {
    provider:
      provider === "all" || providerIds.includes(provider as ProviderId)
        ? ((provider ?? "all") as MerchantSettlementFilters["provider"])
        : "all",
    paymentMode: params.get("paymentMode")?.trim() || "all",
    status: settlementStatuses.includes(
      status as MerchantSettlementStatus | "all",
    )
      ? (status as MerchantSettlementFilters["status"])
      : "all",
  };
}

export async function loadMerchantSettlementWorkspace(
  organizationId: string,
  params: URLSearchParams,
) {
  const filters = parseMerchantSettlementFilters(params);
  const settlements = await listMerchantSettlements(organizationId, filters);
  return {
    summary: {
      batchCount: settlements.length,
      grossAmount: sumNumbers(settlements.map((item) => item.grossAmount)),
      deductionAmount: sumNumbers(
        settlements.map((item) => item.deductionAmount),
      ),
      netAmount: sumNumbers(settlements.map((item) => item.netAmount)),
      bankCreditAmount: sumNumbers(
        settlements.map((item) => item.bankCreditAmount),
      ),
      heldAmount: sumNumbers(
        settlements
          .filter((item) => item.status === "held")
          .map((item) => item.netAmount),
      ),
      failedAmount: sumNumbers(
        settlements
          .filter((item) => item.status === "failed")
          .map((item) => item.netAmount),
      ),
      exceptionCount: settlements.filter(
        (item) =>
          !["matched", "not_due", "awaiting_credit"].includes(
            item.utrMatchStatus,
          ),
      ).length,
    },
    filters,
    settlements,
  };
}

export async function refreshMerchantSettlements(
  actor: Actor,
  clock: MerchantSettlementRefreshClock = {},
) {
  return transaction(async (client) => {
    await lockMerchantSettlementRefresh(client, actor.organizationId);
    const merchantAccountId = await ensureDefaultMerchantAccount(
      client,
      actor.organizationId,
    );
    const candidates = await listRefreshCandidates(client, actor.organizationId);
    let createdBatches = 0;
    let updatedBatches = 0;

    for (const candidate of candidates) {
      const arithmetic = calculateSettlementArithmetic({
        grossAmounts: candidate.lines.map((line) => line.grossAmount),
        deductions: candidate.lines.map((line) =>
          Math.max(
            0,
            line.grossAmount -
              (line.expectedNet ?? line.settledAmount ?? line.grossAmount),
          ),
        ),
        bankCredits:
          candidate.utr && candidate.actualSettlementAt
            ? [
                candidate.lines.reduce(
                  (total, line) =>
                    total +
                    (line.settledAmount ??
                      line.expectedNet ??
                      line.grossAmount),
                  0,
                ),
              ]
            : [],
      });
      const classification = classifyUtr({
        utr: candidate.utr,
        netAmount: arithmetic.netAmount,
        bankCredits:
          candidate.utr && arithmetic.bankCreditAmount > 0
            ? [{ utr: candidate.utr, amount: arithmetic.bankCreditAmount }]
            : [],
        expectedSettlementAt: candidate.expectedSettlementAt,
        actualSettlementAt: candidate.actualSettlementAt,
        status: candidate.lines.every((line) => line.lineStatus === "held")
          ? "held"
          : undefined,
        now: clock.now,
      });
      const batch = await upsertSettlementBatch(client, {
        organizationId: actor.organizationId,
        merchantAccountId,
        candidate,
        ...arithmetic,
        bankCreditAmount: classification.bankCreditAmount,
        varianceAmount: classification.varianceAmount,
        status: classification.settlementStatus,
        utrMatchStatus: classification.status,
        classificationEvidence: classification.evidence,
      });
      if (batch.inserted) createdBatches += 1;
      else updatedBatches += 1;
      await replaceSettlementChildren(client, {
        organizationId: actor.organizationId,
        batchId: batch.id,
        actor,
        candidate,
        deductionAmount: arithmetic.deductionAmount,
        netAmount: arithmetic.netAmount,
        bankCreditAmount: classification.bankCreditAmount,
        utrMatchStatus: classification.status,
        classificationEvidence: classification.evidence,
      });

      // Slice 6b — Bridge 2: re-read the deductions + bank credits we
      // just wrote and post them to the ledger as fee/gst/bank_credit/
      // payout entries. The provider_receivable account for this PG
      // updates atomically inside the caller's transaction.
      const ledgerSource = await loadSettlementSourceForLedger(
        client,
        actor.organizationId,
        batch.id,
      );
      await postSettlementEntries(
        client,
        actor.organizationId,
        {
          batchId: batch.id,
          merchantAccountId,
          provider: candidate.providerId,
          utr: candidate.utr,
          effectiveAt:
            candidate.actualSettlementAt ?? candidate.expectedSettlementAt,
          netAmount: arithmetic.netAmount,
          deductions: ledgerSource.deductions,
          bankCredits: ledgerSource.bankCredits,
        },
        { id: actor.id, name: actor.name },
      );
    }

    const affectedOrderIds = new Set<string>();
    for (const candidate of candidates) {
      for (const line of candidate.lines) {
        if (line.orderId) affectedOrderIds.add(line.orderId);
      }
    }
    if (affectedOrderIds.size > 0) {
      await refreshReasonCodesForOrders(
        client,
        actor.organizationId,
        Array.from(affectedOrderIds),
        "merchant_settlement_status_changed",
        { id: actor.id, name: actor.name },
      );
    }

    // Slice 4: after per-item reason codes refresh, run the group-level
    // payout sum check. Ordering matters — sum-check runs last so it wins
    // the precedence guard (see refreshReasonCodesForOrders' IS DISTINCT
    // FROM 'payout_sum_mismatch' clause).
    const affectedPayoutIds = new Set<string>();
    for (const candidate of candidates) {
      affectedPayoutIds.add(buildStatementReference(candidate));
    }
    if (affectedPayoutIds.size > 0) {
      await refreshPayoutSumChecks(
        client,
        actor.organizationId,
        Array.from(affectedPayoutIds),
        "merchant_settlement_refresh",
        { id: actor.id, name: actor.name },
      );

      // Slice 5: load refund deductions for the affected batches and
      // run the refund-allocation hook AFTER the payout sum check so
      // group-level payout_sum_mismatch keeps precedence.
      const refundCandidates = await loadRefundCandidatesForStatements(
        client,
        actor.organizationId,
        Array.from(affectedPayoutIds),
      );
      await refreshRefundAllocations(
        client,
        actor.organizationId,
        refundCandidates,
        "merchant_settlement_refresh",
        { id: actor.id, name: actor.name },
      );
    }

    const result = {
      scannedItems: candidates.reduce(
        (total, candidate) => total + candidate.lines.length,
        0,
      ),
      refreshedBatches: candidates.length,
      createdBatches,
      updatedBatches,
    };
    await recordAuditEvent(
      {
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        actorName: actor.name,
        action: "merchant_settlements.refreshed",
        entityType: "organization",
        entityId: actor.organizationId,
        details: result,
      },
      client,
    );
    return result;
  });
}

export { getMerchantSettlement };

function moneyToCents(value: number | string): number {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error("Invalid settlement amount.");
  return Math.round(amount * 100);
}

function sumCents(values: Array<number | string>): number {
  return values.reduce<number>(
    (total, value) => total + moneyToCents(value),
    0,
  );
}

function centsToMoney(value: number): number {
  return Number((value / 100).toFixed(2));
}

function sumNumbers(values: number[]): number {
  return Number(values.reduce((total, value) => total + value, 0).toFixed(2));
}

function coerceDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid settlement date.");
  return date;
}
