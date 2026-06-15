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
  priority: "low" | "medium" | "high";
  status: CaseStatus;
  owner: string | null;
  notes: string;
  dueAt: string;
  resolvedAt: string | null;
  slaStatus: SlaStatus;
  createdAt: string;
  updatedAt: string;
  latestInvestigation: AIInvestigation | null;
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
};

export type EvaluationRunDetail = EvaluationRun & {
  cases: EvaluationCaseResult[];
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
};
