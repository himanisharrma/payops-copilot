import type { ProviderId, SettlementCycle } from "@/lib/types";

export type MerchantSettlementStatus =
  | "expected"
  | "scheduled"
  | "sent"
  | "credited"
  | "held"
  | "failed"
  | "partially_credited";

export type MerchantSettlementUtrStatus =
  | "matched"
  | "missing_utr"
  | "utr_not_found"
  | "duplicate_utr"
  | "amount_mismatch"
  | "failed_payout"
  | "held_settlement"
  | "delayed_credit"
  | "retry_exhausted"
  | "awaiting_credit"
  | "not_due";

export type MerchantSettlementListItem = {
  id: string;
  statementReference: string;
  merchant: {
    id: string;
    reference: string;
    name: string;
  };
  providerId: ProviderId;
  paymentMode: string;
  settlementCycle: SettlementCycle | "manual";
  status: MerchantSettlementStatus;
  utr: string | null;
  expectedSettlementAt: string;
  actualSettlementAt: string | null;
  grossAmount: number;
  deductionAmount: number;
  netAmount: number;
  bankCreditAmount: number;
  varianceAmount: number;
  utrMatchStatus: MerchantSettlementUtrStatus;
  lineCount: number;
  deductionCount: number;
  caseCount: number;
  updatedAt: string;
};

export type MerchantSettlementDetail = MerchantSettlementListItem & {
  classificationEvidence: Record<string, unknown>;
  lines: MerchantSettlementLine[];
  deductions: MerchantSettlementDeduction[];
  bankCredits: MerchantSettlementBankCredit[];
  caseLinks: MerchantSettlementCaseLink[];
  events: MerchantSettlementEvent[];
};

export type MerchantSettlementLine = {
  id: string;
  sourceItemId: string | null;
  sourceRunId: string | null;
  orderId: string;
  gatewayReference: string;
  transactionAt: string | null;
  paymentMode: string;
  grossAmount: number;
  deductionAmount: number;
  netAmount: number;
  lineStatus: "included" | "held" | "failed" | "reversed" | "adjusted";
  evidence: Record<string, unknown>;
};

export type MerchantSettlementDeduction = {
  id: string;
  lineId: string | null;
  deductionType:
    | "mdr"
    | "commission"
    | "gst"
    | "refund"
    | "chargeback"
    | "recovery"
    | "adjustment"
    | "rental"
    | "subscription"
    | "hold"
    | "hold_release"
    | "rounding";
  direction: "current_settlement" | "forward_deduction" | "release";
  amount: number;
  taxAmount: number;
  description: string;
  forwardApplied: boolean;
  evidence: Record<string, unknown>;
};

export type MerchantSettlementBankCredit = {
  id: string;
  utr: string;
  amount: number;
  creditedAt: string;
  bankReference: string;
  matchStatus: "matched" | "unmatched" | "duplicate" | "amount_mismatch";
  evidence: Record<string, unknown>;
};

export type MerchantSettlementCaseLink = {
  id: string;
  caseId: string;
  linkType: "utr_exception" | "amount_exception" | "settlement_delay" | "manual_review";
  linkedAt: string;
};

export type MerchantSettlementEvent = {
  id: string;
  actorName: string;
  eventType: "batch_refreshed" | "classification_updated" | "case_linked";
  details: Record<string, unknown>;
  createdAt: string;
};

export type MerchantSettlementFilters = {
  status: MerchantSettlementStatus | "all";
  provider: ProviderId | "all";
  paymentMode: string | "all";
};

export type MerchantSettlementWorkspace = {
  summary: {
    batchCount: number;
    grossAmount: number;
    deductionAmount: number;
    netAmount: number;
    bankCreditAmount: number;
    heldAmount: number;
    failedAmount: number;
    exceptionCount: number;
  };
  filters: MerchantSettlementFilters;
  settlements: MerchantSettlementListItem[];
};

export type RefreshMerchantSettlementsResult = {
  scannedItems: number;
  refreshedBatches: number;
  createdBatches: number;
  updatedBatches: number;
};
