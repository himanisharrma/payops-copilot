export type RawRecord = Record<string, string | number | null | undefined>;

export type ReconciliationRequest = {
  orders: RawRecord[];
  gateway: RawRecord[];
  settlements: RawRecord[];
  runName?: string;
  sourceType?: "demo" | "upload";
  sourceFiles?: {
    orders?: string;
    gateway?: string;
    settlements?: string;
  };
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
  id?: string;
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

export type CaseStatus = "open" | "investigating" | "resolved";

export type OperationsCase = {
  id: string;
  runId: string;
  runName: string;
  orderId: string;
  gatewayReference: string;
  paymentMode: string;
  orderAmount: number;
  variance: number;
  reconciliationStatus: ReconciliationStatus;
  summary: string;
  evidence: string[];
  priority: "low" | "medium" | "high";
  status: CaseStatus;
  owner: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type RunSummary = ReconciliationResult["summary"] & {
  id: string;
  name: string;
  sourceType: string;
  status: string;
  createdAt: string;
};
