import type { ProviderId } from "@/lib/types";

export type SettlementImportStatus = "staged" | "compared" | "needs_review" | "closed";
export type SettlementImportExceptionType =
  | "missing_utr"
  | "utr_not_found"
  | "duplicate_utr"
  | "amount_mismatch"
  | "failed_payout"
  | "held_settlement"
  | "delayed_credit"
  | "retry_exhausted"
  | "deduction_mismatch"
  | "unexplained_hold"
  | "forward_deduction_mismatch";
export type SettlementImportComparisonStatus = "matched" | "exception";
export type SettlementAdjustmentStatus =
  | "proposed"
  | "approved"
  | "rejected"
  | "withdrawn";
export type SettlementAdjustmentType =
  | "credit_note"
  | "debit_note"
  | "hold_release"
  | "write_off"
  | "manual_review";

export type NormalizedSettlementImportRow = {
  rowNumber: number;
  statementReference: string;
  merchantReference: string;
  orderId: string;
  gatewayReference: string;
  paymentMode: string;
  grossAmount: number;
  deductionAmount: number;
  netAmount: number;
  deductionType: string | null;
  utr: string | null;
  bankReference: string | null;
  settlementStatus:
    | "expected"
    | "scheduled"
    | "sent"
    | "credited"
    | "held"
    | "failed"
    | "partially_credited";
  expectedSettlementAt: string | null;
  actualSettlementAt: string | null;
  rawValues: Record<string, string>;
  normalizedValues: Record<string, unknown>;
  rowFingerprint: string;
};

export type SettlementImportBatch = {
  id: string;
  providerId: ProviderId;
  importReference: string;
  sourceFilename: string;
  sourceHash: string;
  status: SettlementImportStatus;
  rowCount: number;
  exceptionCount: number;
  importedByName: string;
  importedAt: string;
  updatedAt: string;
};

export type SettlementImportException = {
  id: string;
  importBatchId: string;
  rowId: string;
  comparisonId: string;
  settlementBatchId: string | null;
  operationsCaseId: string | null;
  exceptionType: SettlementImportExceptionType;
  priority: "low" | "medium" | "high";
  status: "open" | "adjustment_proposed" | "resolved";
  exposureAmount: number;
  summary: string;
  evidence: Record<string, unknown>;
  createdAt: string;
  adjustment: SettlementAdjustmentProposal | null;
};

export type SettlementImportComparison = {
  id: string;
  rowId: string;
  settlementBatchId: string | null;
  settlementLineId: string | null;
  bankCreditId: string | null;
  operationsCaseId: string | null;
  comparisonStatus: SettlementImportComparisonStatus;
  exceptionType: SettlementImportExceptionType | null;
  amountVariance: number;
  deductionVariance: number;
  evidence: Record<string, unknown>;
  comparedAt: string;
};

export type SettlementAdjustmentProposal = {
  id: string;
  exceptionId: string;
  adjustmentType: SettlementAdjustmentType;
  amount: number;
  reason: string;
  evidenceReference: string;
  status: SettlementAdjustmentStatus;
  proposedByName: string;
  decidedByName: string | null;
  decisionReason: string | null;
  decidedAt: string | null;
  createdAt: string;
};

export type SettlementImportDetail = SettlementImportBatch & {
  rows: NormalizedSettlementImportRow[];
  comparisons: SettlementImportComparison[];
  exceptions: SettlementImportException[];
  summary: SettlementImportSummary;
};

export type SettlementImportSummary = {
  imports: number;
  importedRows: number;
  matchedRows: number;
  exceptions: number;
  openExceptions: number;
  proposedAdjustments: number;
  approvedAdjustments: number;
  exposureAmount: number;
};

export type SettlementImportFilters = {
  provider: ProviderId | "all";
  status: SettlementImportStatus | "all";
  exceptionType: SettlementImportExceptionType | "all";
  adjustmentState: SettlementAdjustmentStatus | "none" | "all";
  linkedCase: "all" | "linked" | "unlinked";
};

export type SettlementImportWorkspace = {
  filters: SettlementImportFilters;
  summary: SettlementImportSummary;
  imports: SettlementImportBatch[];
  latestExceptions: SettlementImportException[];
};
