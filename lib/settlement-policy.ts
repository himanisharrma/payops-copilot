import {
  addBusinessDays,
  indiaDateParts,
  indiaDateTime,
  nextBusinessDay,
} from "@/lib/settlement-calendar";
import type {
  ProviderId,
  ReconciliationStatus,
  SettlementCycle,
  SettlementPolicy,
  SettlementTimestampSource,
  SettlementTimingEvidence,
  SettlementTimingStatus,
} from "@/lib/types";

export const SETTLEMENT_POLICY_VERSION = "settlement-policy-v1" as const;
export const SETTLEMENT_CAPTURE_CUTOFF = "15:00" as const;
export const SETTLEMENT_DEADLINE_CUTOFF = "18:00" as const;

const DEFAULT_CYCLE: SettlementCycle = "T+2";
const CYCLE_DAYS: Record<SettlementCycle, number> = {
  "T+0": 0,
  "T+1": 1,
  "T+2": 2,
};

const POLICY_MATRIX: Record<
  ProviderId,
  Record<"UPI" | "CARD" | "NETBANKING" | "WALLET", SettlementCycle>
> = {
  generic: {
    UPI: "T+0",
    CARD: "T+2",
    NETBANKING: "T+1",
    WALLET: "T+1",
  },
  razorpay_demo: {
    UPI: "T+1",
    CARD: "T+2",
    NETBANKING: "T+1",
    WALLET: "T+1",
  },
  cashfree_demo: {
    UPI: "T+0",
    CARD: "T+1",
    NETBANKING: "T+1",
    WALLET: "T+1",
  },
  payu_demo: {
    UPI: "T+1",
    CARD: "T+2",
    NETBANKING: "T+2",
    WALLET: "T+1",
  },
};

function normalizePaymentMode(value: string) {
  return value.trim().replace(/[\s_-]+/g, "").toUpperCase();
}

export function parseExplicitOffsetTimestamp(value: string) {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = Number((match[7] ?? "").padEnd(3, "0"));
  const offset = match[8];
  const offsetMinutes =
    offset === "Z"
      ? 0
      : (offset.startsWith("-") ? -1 : 1) *
        (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));

  if (
    month < 1 ||
    month > 12 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    Math.abs(offsetMinutes) > 14 * 60
  ) {
    return null;
  }

  const localTimestamp = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
    millisecond,
  );
  const localCheck = new Date(localTimestamp);
  if (
    localCheck.getUTCFullYear() !== year ||
    localCheck.getUTCMonth() !== month - 1 ||
    localCheck.getUTCDate() !== day
  ) {
    return null;
  }

  const parsed = new Date(localTimestamp - offsetMinutes * 60_000);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getSettlementPolicy(
  providerId: ProviderId,
  paymentMode: string,
): SettlementPolicy {
  const normalizedMode = normalizePaymentMode(paymentMode);
  const supportedMode = normalizedMode as keyof (typeof POLICY_MATRIX)[ProviderId];
  const cycle = POLICY_MATRIX[providerId][supportedMode] ?? DEFAULT_CYCLE;

  return {
    providerId,
    paymentMode,
    cycle,
    captureCutoff: SETTLEMENT_CAPTURE_CUTOFF,
    settlementCutoff: SETTLEMENT_DEADLINE_CUTOFF,
    timezone: "Asia/Kolkata",
    policyVersion: SETTLEMENT_POLICY_VERSION,
    calendarVersion: "india-demo-calendar-v1",
    usedFallback: POLICY_MATRIX[providerId][supportedMode] === undefined,
  };
}

export type ExpectedSettlementResult =
  | {
      expectedSettlementAt: Date;
      policy: SettlementPolicy;
      evidence: SettlementTimingEvidence;
    }
  | {
      expectedSettlementAt: null;
      policy: SettlementPolicy;
      evidence: null;
    };

export function calculateExpectedSettlement(input: {
  providerId: ProviderId;
  paymentMode: string;
  transactionAt: string | null | undefined;
  transactionTimestampSource: SettlementTimestampSource;
}): ExpectedSettlementResult {
  const policy = getSettlementPolicy(input.providerId, input.paymentMode);
  if (!input.transactionAt) {
    return { expectedSettlementAt: null, policy, evidence: null };
  }

  const transactionAt = parseExplicitOffsetTimestamp(input.transactionAt);
  if (!transactionAt) {
    return { expectedSettlementAt: null, policy, evidence: null };
  }

  const indiaTransaction = indiaDateParts(transactionAt);
  const afterCaptureCutoff =
    indiaTransaction.hour > 15 ||
    (indiaTransaction.hour === 15 &&
      (indiaTransaction.minute > 0 ||
        indiaTransaction.second > 0 ||
        indiaTransaction.millisecond > 0));

  const initialAnchor = afterCaptureCutoff
    ? nextBusinessDay(indiaTransaction.date)
    : { date: indiaTransaction.date, skippedDates: [] };
  const target = addBusinessDays(
    initialAnchor.date,
    CYCLE_DAYS[policy.cycle],
  );
  const skippedNonBusinessDates = [
    ...initialAnchor.skippedDates,
    ...target.skippedDates,
  ];
  const expectedSettlementAt = indiaDateTime(target.date, 18, 0);

  return {
    expectedSettlementAt,
    policy,
    evidence: {
      providerId: policy.providerId,
      paymentMode: input.paymentMode,
      cycle: policy.cycle,
      transactionAt: transactionAt.toISOString(),
      transactionTimestampSource: input.transactionTimestampSource,
      captureCutoff: policy.captureCutoff,
      afterCaptureCutoff,
      cycleAnchorDate: initialAnchor.date,
      skippedNonBusinessDates: [...new Set(skippedNonBusinessDates)],
      expectedSettlementAt: expectedSettlementAt.toISOString(),
      settlementCutoff: policy.settlementCutoff,
      timezone: policy.timezone,
      policyVersion: policy.policyVersion,
      calendarVersion: policy.calendarVersion,
      usedFallbackPolicy: policy.usedFallback,
    },
  };
}

export function classifySettlement(input: {
  hasSettlementRecord: boolean;
  expectedSettlementAt: string | Date | null;
  now: string | Date;
}): SettlementTimingStatus {
  if (input.hasSettlementRecord) return "settled";
  if (!input.expectedSettlementAt) return "timing_unavailable";

  const expected = new Date(input.expectedSettlementAt);
  const now = new Date(input.now);
  if (
    Number.isNaN(expected.getTime()) ||
    Number.isNaN(now.getTime())
  ) {
    return "timing_unavailable";
  }

  if (now.getTime() > expected.getTime()) return "overdue";
  if (indiaDateParts(now).date === indiaDateParts(expected).date) {
    return "due_today";
  }
  return "not_due";
}

export function settlementDelayHours(input: {
  expectedSettlementAt: string | Date | null;
  settlementRecordedAt: string | Date | null;
}) {
  if (!input.expectedSettlementAt || !input.settlementRecordedAt) return null;
  const expected = new Date(input.expectedSettlementAt).getTime();
  const recorded = new Date(input.settlementRecordedAt).getTime();
  if (Number.isNaN(expected) || Number.isNaN(recorded)) return null;
  return (recorded - expected) / 3_600_000;
}

export function settlementDaysOverdue(input: {
  expectedSettlementAt: string | Date | null;
  now: string | Date;
}) {
  if (!input.expectedSettlementAt) return null;
  const expected = new Date(input.expectedSettlementAt).getTime();
  const now = new Date(input.now).getTime();
  if (Number.isNaN(expected) || Number.isNaN(now)) return null;
  return Math.max(0, (now - expected) / 86_400_000);
}

export function isCaseActionable(input: {
  reconciliationStatus: ReconciliationStatus;
  settlementStatus?: SettlementTimingStatus | null;
}) {
  if (
    input.reconciliationStatus === "gateway_missing" ||
    input.reconciliationStatus === "duplicate" ||
    input.reconciliationStatus === "amount_mismatch"
  ) {
    return true;
  }
  if (input.reconciliationStatus === "missing_settlement") {
    return input.settlementStatus === "overdue";
  }
  return false;
}
