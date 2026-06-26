export type SourceIngestionProviderId =
  | "generic"
  | "razorpay_demo"
  | "cashfree_demo"
  | "payu_demo"
  | "paytm_demo"
  | "bank_demo"
  | "internal_ledger";

export type SourceKind =
  | "internal_orders"
  | "gateway_report"
  | "settlement_statement"
  | "bank_statement"
  | "refunds_report"
  | "chargebacks_report";

export type SourceTransportType =
  | "manual_upload"
  | "email_demo"
  | "sftp_demo"
  | "dashboard_export_demo"
  | "api_demo";

export type ExpectedFrequency = "daily" | "weekly" | "monthly" | "ad_hoc";
export type SourceExpectationStatus =
  | "expected"
  | "arrived"
  | "late"
  | "missing"
  | "waived";
export type SourceArrivalClassification =
  | "on_time"
  | "late"
  | "duplicate"
  | "revised"
  | "partial"
  | "schema_failed"
  | "empty_file"
  | "hash_mismatch";
export type SourceValidationStatus = "accepted" | "needs_review" | "rejected";
export type DownstreamWorkflow =
  | "reconciliation"
  | "settlement_import"
  | "close_control"
  | "manual_review";

export type SourceIngestionSource = {
  id: string;
  sourceKey: string;
  displayName: string;
  providerId: SourceIngestionProviderId;
  sourceKind: SourceKind;
  transportType: SourceTransportType;
  expectedFrequency: ExpectedFrequency;
  ownerTeam: string;
  active: boolean;
  evidence: Record<string, unknown>;
};

export type SourceIngestionExpectation = {
  id: string;
  sourceId: string;
  sourceKey: string;
  displayName: string;
  providerId: SourceIngestionProviderId;
  sourceKind: SourceKind;
  transportType: SourceTransportType;
  ownerTeam: string;
  businessDate: string;
  expectedArrivalAt: string;
  graceMinutes: number;
  requiredForClose: boolean;
  expectedFilenamePattern: string;
  status: SourceExpectationStatus;
  latestArrival: SourceIngestionArrival | null;
};

export type SourceIngestionArrival = {
  id: string;
  expectationId: string;
  sourceId: string;
  fileName: string;
  fileHash: string;
  sourceRowCount: number;
  acceptedRowCount: number;
  rejectedRowCount: number;
  receivedAt: string;
  supersedesArrivalId: string | null;
  classification: SourceArrivalClassification;
  validationStatus: SourceValidationStatus;
  downstreamWorkflow: DownstreamWorkflow;
  linkedReconciliationRunId: string | null;
  linkedSettlementImportId: string | null;
  evidence: {
    headers?: string[];
    missingHeaders?: string[];
    amountTotals?: Record<string, number>;
    dateRange?: { min: string | null; max: string | null };
    diagnostics?: Array<{
      severity: "info" | "warning" | "error";
      code: string;
      message: string;
    }>;
    [key: string]: unknown;
  };
};

export type SourceIngestionEvent = {
  id: string;
  sourceId: string | null;
  expectationId: string | null;
  arrivalId: string | null;
  actorName: string;
  eventType:
    | "source_registered"
    | "expectation_scheduled"
    | "file_arrived"
    | "file_rejected"
    | "expectation_waived"
    | "control_refreshed";
  details: Record<string, unknown>;
  createdAt: string;
};

export type SourceReadinessSummary = {
  businessDate: string;
  verdict: "ready" | "blocked";
  expectedFiles: number;
  acceptedFiles: number;
  missingFiles: number;
  lateFiles: number;
  quarantinedFiles: number;
  blockingFiles: number;
  optionalWarnings: number;
};

export type SourceIngestionWorkspace = {
  summary: SourceReadinessSummary;
  expectations: SourceIngestionExpectation[];
  events: SourceIngestionEvent[];
};
