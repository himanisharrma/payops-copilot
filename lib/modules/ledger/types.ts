export type AccountRole =
  | "merchant_payable"
  | "provider_receivable"
  | "escrow_cash"
  | "fee_expense"
  | "gst_liability"
  | "refund_payable";

export type AccountType =
  | "asset"
  | "liability"
  | "equity"
  | "income"
  | "expense";

export type ProviderId =
  | "generic"
  | "razorpay_demo"
  | "cashfree_demo"
  | "payu_demo";

export type SourceType =
  | "capture"
  | "refund_initiation"
  | "refund_netting"
  | "payout"
  | "bank_credit"
  | "fee"
  | "gst"
  | "adjustment";

export type EntryDirection = "debit" | "credit";

export type LedgerAccount = {
  id: string;
  merchantAccountId: string;
  accountRole: AccountRole;
  accountType: AccountType;
  provider: ProviderId | null;
  currency: "INR";
  createdAt: string;
};

export type LedgerEntry = {
  id: string;
  transactionId: string;
  accountId: string;
  accountRole: AccountRole;
  provider: ProviderId | null;
  direction: EntryDirection;
  amount: number;
  currency: "INR";
  createdAt: string;
};

export type LedgerTransaction = {
  id: string;
  sourceType: SourceType;
  sourceId: string | null;
  sourceBatchId: string | null;
  externalRefs: Record<string, unknown>;
  effectiveAt: string;
  postedAt: string;
  idempotencyKey: string;
  description: string | null;
  reversalOf: string | null;
  entries: LedgerEntry[];
};

export type BalanceRow = {
  accountRole: AccountRole;
  provider: ProviderId | null;
  balance: number;
};

export type PostResult = {
  transactionsPosted: number;
  transactionsSkippedIdempotent: number;
  entriesWritten: number;
};

// Source-event inputs that bridges from existing services will pass in.

export type CaptureSource = {
  sourceItemId: string;
  merchantAccountId: string;
  provider: ProviderId;
  grossAmount: number;
  effectiveAt: Date;
  externalRefs: { orderId: string; gatewayReference: string };
};

export type SettlementDeductionInput = {
  sourceDeductionId: string;
  type:
    | "mdr"
    | "commission"
    | "gst"
    | "refund"
    | "chargeback"
    | "adjustment"
    | "hold"
    | "hold_release"
    | "rounding"
    | "rental"
    | "subscription"
    | "recovery";
  amount: number;
  taxAmount: number;
};

export type SettlementBankCreditInput = {
  sourceBankCreditId: string;
  amount: number;
  creditedAt: Date;
};

export type SettlementSource = {
  batchId: string;
  merchantAccountId: string;
  provider: ProviderId;
  utr: string | null;
  effectiveAt: Date;
  netAmount: number;
  deductions: SettlementDeductionInput[];
  bankCredits: SettlementBankCreditInput[];
};

export type RefundAllocationSource = {
  allocationId: string;
  merchantAccountId: string;
  provider: ProviderId;
  amount: number;
  effectiveAt: Date;
  externalRefs: { refundOrderId: string; refundExternalReference: string };
};

export type Actor = { id: string | null; name: string };
