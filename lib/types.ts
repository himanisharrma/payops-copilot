export type RawRecord = Record<string, string | number | null | undefined>;

export type ReconciliationRequest = {
  orders: RawRecord[];
  gateway: RawRecord[];
  settlements: RawRecord[];
};

export type ReconciliationStatus =
  | "matched"
  | "amount_mismatch"
  | "missing_settlement"
  | "gateway_missing"
  | "duplicate"
  | "pending";

export type ReconciliationItem = {
  orderId: string;
  gatewayReference: string;
  paymentMode: string;
  orderAmount: number;
  gatewayAmount: number | null;
  settledAmount: number | null;
  expectedNet: number | null;
  variance: number;
  status: ReconciliationStatus;
  severity: "low" | "medium" | "high";
  summary: string;
  evidence: string[];
};

export type ReconciliationResult = {
  generatedAt: string;
  summary: {
    totalOrders: number;
    processedValue: number;
    matchedValue: number;
    unmatchedValue: number;
    matchedCount: number;
    exceptionCount: number;
    matchRate: number;
  };
  items: ReconciliationItem[];
};
