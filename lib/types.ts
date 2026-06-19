export type RawRecord = Record<string, string | number | null | undefined>;

export type ReconciliationRequest = {
  orders: RawRecord[];
  gateway: RawRecord[];
  settlements: RawRecord[];
  providerId?: ProviderId;
  runName?: string;
  sourceType?: "demo" | "upload";
  sourceFiles?: {
    orders?: string;
    gateway?: string;
    settlements?: string;
  };
};

export type ProviderId =
  | "generic"
  | "razorpay_demo"
  | "cashfree_demo"
  | "payu_demo";

export type ProviderFieldMapping =
  | "orderId"
  | "amount"
  | "status"
  | "paymentMode"
  | "gatewayReference"
  | "settledAmount"
  | "fee"
  | "tax"
  | "utr";

export type DataQualityIssue = {
  severity: "info" | "warning" | "error";
  source: "orders" | "gateway" | "settlements";
  code:
    | "missing_field_mapping"
    | "invalid_amount"
    | "duplicate_order_reference"
    | "unknown_status";
  message: string;
};

export type ProviderDataQualityReport = {
  providerId: ProviderId;
  providerName: string;
  settlementCycle: string;
  assumptions: string[];
  rowCounts: {
    orders: number;
    gateway: number;
    settlements: number;
  };
  fieldCoverage: Record<
    "orders" | "gateway" | "settlements",
    Array<{
      field: ProviderFieldMapping;
      matchedHeader: string | null;
    }>
  >;
  issues: DataQualityIssue[];
};

export type ProviderWebhookPayload = {
  providerId: Exclude<ProviderId, "generic">;
  eventType: string;
  occurredAt: string;
  payload: Record<string, unknown>;
};

export type NormalizedProviderEvent = {
  id: string;
  providerId: Exclude<ProviderId, "generic">;
  eventType:
    | "payment_captured"
    | "settlement_processed"
    | "refund_initiated"
    | "refund_completed"
    | "chargeback_received"
    | "chargeback_evidence_due";
  title: string;
  orderId: string | null;
  paymentReference: string | null;
  externalReference: string | null;
  amount: number | null;
  status: string | null;
  occurredAt: string;
  proves: string;
  doesNotProve: string;
};

export type ReconciliationStatus =
  | "matched"
  | "amount_mismatch"
  | "missing_settlement"
  | "gateway_missing"
  | "duplicate"
  | "pending";

export type EvidenceSourceType = "orders" | "gateway" | "settlements";

export type SourceEvidence = {
  sourceType: EvidenceSourceType;
  rowNumber: number;
  normalizedValues: Record<string, string | number | null>;
  sourceValues: Record<string, string | number | null>;
  integrityHash: string;
};

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
  sourceEvidence: SourceEvidence[];
};

export type ReconciliationResult = {
  id?: string;
  generatedAt: string;
  providerReport?: ProviderDataQualityReport;
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
export type SlaStatus =
  | "on_track"
  | "at_risk"
  | "overdue"
  | "met"
  | "breached";

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
  sourceEvidence: SourceEvidence[];
  priority: "low" | "medium" | "high";
  status: CaseStatus;
  owner: string | null;
  notes: string;
  dueAt: string;
  resolvedAt: string | null;
  resolutionReason: string | null;
  resolutionEvidenceConfirmed: boolean;
  resolvedByName: string | null;
  slaStatus: SlaStatus;
  createdAt: string;
  updatedAt: string;
  latestInvestigation: AIInvestigation | null;
  providerEvents?: NormalizedProviderEvent[];
};

export type InvestigationConfidence = "low" | "medium" | "high";
export type InvestigationApproval = "pending" | "approved" | "rejected";

export type InvestigationAnalysis = {
  likelyCause: string;
  confidence: InvestigationConfidence;
  supportingEvidence: string[];
  recommendedActions: string[];
  providerMessage: string;
  limitations: string[];
};

export type AIInvestigation = InvestigationAnalysis & {
  id: string;
  caseId: string;
  provider: "openai" | "deterministic";
  model: string;
  promptVersion: string;
  approvalStatus: InvestigationApproval;
  feedbackRating: "helpful" | "not_helpful" | null;
  feedbackNotes: string;
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

export type AuditEvent = {
  id: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  createdAt: string;
};

export type EvaluationScenarioResult = {
  scenario:
    | ReconciliationStatus
    | "adversarial";
  total: number;
  passing: number;
  averageScore: number;
  criticalSafetyFailures: number;
};

export type EvaluationRun = {
  id: string;
  datasetVersion: string;
  promptVersion: string;
  provider: "deterministic" | "openai";
  model: string;
  totalCases: number;
  passingCases: number;
  passRate: number;
  checksPassed: number;
  checksTotal: number;
  criticalSafetyFailures: number;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  createdByName: string;
  createdAt: string;
  scenarios: EvaluationScenarioResult[];
};

export type EvaluationReviewScores = {
  grounding: number | null;
  safety: number | null;
  uncertainty: number | null;
  action: number | null;
  providerMessage: number | null;
  completeness: number | null;
};

export type EvaluationReviewerAssignment = {
  slot: 1 | 2;
  reviewerUserId: string;
  reviewerName: string;
  assignedAt: string;
};

export type EvaluationCaseReview = {
  id: string;
  reviewerUserId: string;
  reviewerName: string;
  reviewerSlot: 1 | 2;
  scores: EvaluationReviewScores;
  notes: string;
  totalScore: number;
  reviewedAt: string;
};

export type EvaluationCaseAdjudication = {
  scores: EvaluationReviewScores;
  notes: string;
  totalScore: number;
  adjudicatedByName: string;
  adjudicatedAt: string;
};

export type EvaluationReviewStatus =
  | "unreviewed"
  | "single_review"
  | "agreed"
  | "disputed"
  | "adjudicated";

export type EvaluationCaseResult = {
  id: string;
  caseKey: string;
  scenario: EvaluationScenarioResult["scenario"];
  summary: string;
  sourceEvidence: string[];
  analysis: InvestigationAnalysis;
  automatedScore: number;
  automatedPassed: boolean;
  automatedChecks: Record<string, boolean>;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  reviewScores: EvaluationReviewScores;
  reviewerNotes: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviews: EvaluationCaseReview[];
  adjudication: EvaluationCaseAdjudication | null;
  reviewStatus: EvaluationReviewStatus;
  averageHumanScore: number | null;
};

export type EvaluationRunDetail = EvaluationRun & {
  cases: EvaluationCaseResult[];
  reviewerAssignments: EvaluationReviewerAssignment[];
  humanSummary: {
    assignedReviewers: number;
    reviewedCases: number;
    doubleReviewedCases: number;
    disputedCases: number;
    adjudicatedCases: number;
    averageScore: number | null;
  };
};

export type PaymentWorkflowType = "refund" | "chargeback";
export type PaymentWorkflowStatus =
  | "requested"
  | "approved"
  | "processing"
  | "completed"
  | "rejected"
  | "received"
  | "evidence_due"
  | "evidence_submitted"
  | "won"
  | "lost"
  | "accepted";

export type EvidenceChecklistItem = {
  key: string;
  label: string;
  complete: boolean;
};

export type PaymentWorkflowEvent = {
  id: string;
  eventType: string;
  title: string;
  detail: string;
  actorName: string;
  createdAt: string;
};

export type PaymentWorkflow = {
  id: string;
  type: PaymentWorkflowType;
  externalReference: string;
  orderId: string;
  paymentReference: string;
  amount: number;
  reason: string;
  status: PaymentWorkflowStatus;
  priority: "low" | "medium" | "high";
  owner: string | null;
  dueAt: string;
  evidenceChecklist: EvidenceChecklistItem[];
  notes: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  events: PaymentWorkflowEvent[];
  providerEvents?: NormalizedProviderEvent[];
};
