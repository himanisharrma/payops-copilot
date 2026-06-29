export type RefundAllocationStatus = "applied" | "superseded";

export type RefundAllocation = {
  id: string;
  parentItemId: string;
  parentRunId: string;
  refundSourceRunId: string;
  refundExternalReference: string;
  refundOrderId: string;
  refundAmount: number;
  refundTransactionAt: string | null;
  refundSettlementAt: string | null;
  refundUtr: string | null;
  refundStatementReference: string | null;
  status: RefundAllocationStatus;
  createdAt: string;
  updatedAt: string;
};

export type RefundAllocationRefreshTrigger =
  | "reconciliation_run_persisted"
  | "merchant_settlement_refresh";

export type RefundAllocationRefreshResult = {
  candidatesEvaluated: number;
  allocationsApplied: number;
  itemsFlagged: number;
  orphanRefunds: number;
};
