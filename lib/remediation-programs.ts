import type {
  OperationsCaseOrigin,
  ProviderId,
  ReconciliationStatus,
  RemediationFingerprint,
} from "@/lib/types";

export const recurrenceWindowDays = 30;
export const recurrenceMinimumCases = 3;

export function remediationFingerprint(input: RemediationFingerprint) {
  return [
    input.providerId,
    input.paymentMode.trim().toLowerCase(),
    input.reconciliationStatus,
    input.caseOrigin,
  ].join("|");
}

export function deterministicExposure(input: {
  reconciliationStatus: ReconciliationStatus;
  variance: number;
  orderAmount: number;
}) {
  if (input.reconciliationStatus === "amount_mismatch") {
    return Math.abs(input.variance);
  }
  if (
    input.reconciliationStatus === "gateway_missing" ||
    input.reconciliationStatus === "duplicate" ||
    input.reconciliationStatus === "missing_settlement"
  ) {
    return Math.abs(input.orderAmount);
  }
  return 0;
}

export function isActionableFingerprint(input: {
  providerId: ProviderId;
  paymentMode: string;
  reconciliationStatus: ReconciliationStatus;
  caseOrigin: OperationsCaseOrigin;
}) {
  return (
    input.paymentMode.trim().length > 0 &&
    ["amount_mismatch", "missing_settlement", "gateway_missing", "duplicate"]
      .includes(input.reconciliationStatus)
  );
}

export function rankRecurrence(input: {
  caseCount: number;
  exposure: number;
  breachedCases: number;
  lastOccurredAt: string;
}) {
  const recencyDays = Math.max(
    0,
    (Date.now() - new Date(input.lastOccurredAt).getTime()) / 86_400_000,
  );
  return Number(
    (
      input.caseCount * 1000 +
      Math.min(input.exposure, 9_999_999) / 100 +
      input.breachedCases * 250 +
      Math.max(0, 30 - recencyDays)
    ).toFixed(2),
  );
}

export function recurrenceWindow(now = new Date()) {
  return {
    startAt: new Date(now.getTime() - recurrenceWindowDays * 86_400_000),
    endAt: now,
  };
}
