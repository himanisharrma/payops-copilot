import type {
  MatchConfidence,
  MatchStrategy,
  RawRecord,
} from "@/lib/types";

export type NormalizedGatewayRow = {
  raw: RawRecord;
  rowNumber: number;
  orderId: string;
  reference: string;
  amount: number;
  status: string;
  mode: string;
  fee: number;
  tax: number;
  transactionAt: string;
};

export type NormalizedSettlementRow = {
  raw: RawRecord;
  rowNumber: number;
  orderId: string;
  reference: string;
  settledAmount: number;
  utr: string;
  status: string;
  settlementAt: string;
  statementReference: string;
};

export type MatchOutcome = {
  strategy: MatchStrategy;
  confidence: MatchConfidence;
  gateway: NormalizedGatewayRow | null;
  settlement: NormalizedSettlementRow | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const AMOUNT_TOLERANCE_RUPEES = 1;

function sameOrEarlierDay(
  settlementAt: string,
  transactionAt: string,
  windowDays: number,
): boolean {
  if (!settlementAt || !transactionAt) return false;
  const ts = Date.parse(settlementAt);
  const tt = Date.parse(transactionAt);
  if (Number.isNaN(ts) || Number.isNaN(tt)) return false;
  return Math.abs(ts - tt) <= windowDays * DAY_MS;
}

function nearAmount(a: number, b: number): boolean {
  return Math.abs(a - b) <= AMOUNT_TOLERANCE_RUPEES;
}

export function findByExactOrderId(
  orderId: string,
  settlements: NormalizedSettlementRow[],
): NormalizedSettlementRow | null {
  if (!orderId) return null;
  return settlements.find((s) => s.orderId && s.orderId === orderId) ?? null;
}

export function findByGatewayReference(
  gateway: NormalizedGatewayRow,
  settlements: NormalizedSettlementRow[],
): NormalizedSettlementRow | null {
  if (!gateway.reference) return null;
  return (
    settlements.find(
      (s) => s.reference && s.reference === gateway.reference,
    ) ?? null
  );
}

export function findByAmountDateWindow(
  gateway: NormalizedGatewayRow,
  settlements: NormalizedSettlementRow[],
  windowDays = 1,
): NormalizedSettlementRow | null {
  if (!gateway.transactionAt || !Number.isFinite(gateway.amount)) return null;
  return (
    settlements.find(
      (s) =>
        Number.isFinite(s.settledAmount) &&
        nearAmount(s.settledAmount, gateway.amount) &&
        sameOrEarlierDay(s.settlementAt, gateway.transactionAt, windowDays),
    ) ?? null
  );
}

// Tier order is fixed: each strategy describes how the settlement row was
// located given that the gateway row was already found by exact order_id.
// The first non-null strategy wins. When no strategy fires (or no gateway
// exists), the outcome is "unmatched" / "none" — downstream status logic
// then assigns missing_gateway, missing_settlement, etc.
export function selectMatchOutcome(
  orderId: string,
  gateway: NormalizedGatewayRow | undefined,
  settlements: NormalizedSettlementRow[],
): MatchOutcome {
  if (!gateway) {
    return {
      strategy: "unmatched",
      confidence: "none",
      gateway: null,
      settlement: null,
    };
  }

  const byOrderId = findByExactOrderId(orderId, settlements);
  if (byOrderId) {
    return {
      strategy: "exact_order_id",
      confidence: "exact",
      gateway,
      settlement: byOrderId,
    };
  }

  const byReference = findByGatewayReference(gateway, settlements);
  if (byReference) {
    return {
      strategy: "gateway_reference_fallback",
      confidence: "high",
      gateway,
      settlement: byReference,
    };
  }

  const byAmountDate = findByAmountDateWindow(gateway, settlements);
  if (byAmountDate) {
    return {
      strategy: "amount_date_window",
      confidence: "medium",
      gateway,
      settlement: byAmountDate,
    };
  }

  return {
    strategy: "unmatched",
    confidence: "none",
    gateway,
    settlement: null,
  };
}
