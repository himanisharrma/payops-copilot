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

export type SettlementCycle = "T+0" | "T+1" | "T+2";
export type SettlementStatus =
  | "not_due"
  | "due_today"
  | "overdue"
  | "settled";
export type SettlementTimingStatus =
  | SettlementStatus
  | "timing_unavailable";
export type SettlementTimestampSource =
  | "gateway_capture"
  | "order_created";
export type OperationsCaseOrigin =
  | "reconciliation_exception"
  | "settlement_overdue";

export type SettlementPolicy = {
  providerId: ProviderId;
  paymentMode: string;
  cycle: SettlementCycle;
  captureCutoff: "15:00";
  settlementCutoff: "18:00";
  timezone: "Asia/Kolkata";
  policyVersion: "settlement-policy-v1";
  calendarVersion: "india-demo-calendar-v1";
  usedFallback: boolean;
};

export type SettlementTimingEvidence = {
  providerId: ProviderId;
  paymentMode: string;
  cycle: SettlementCycle;
  transactionAt: string;
  transactionTimestampSource: SettlementTimestampSource;
  captureCutoff: "15:00";
  afterCaptureCutoff: boolean;
  cycleAnchorDate: string;
  skippedNonBusinessDates: string[];
  expectedSettlementAt: string;
  settlementCutoff: "18:00";
  timezone: "Asia/Kolkata";
  policyVersion: "settlement-policy-v1";
  calendarVersion: "india-demo-calendar-v1";
  usedFallbackPolicy: boolean;
};

export type ProviderFieldMapping =
  | "orderId"
  | "amount"
  | "status"
  | "paymentMode"
  | "gatewayReference"
  | "transactionAt"
  | "settlementAt"
  | "settledAmount"
  | "fee"
  | "tax"
  | "utr"
  | "statementReference"
  | "transactionType";

export type DataQualityIssue = {
  severity: "info" | "warning" | "error";
  source: "orders" | "gateway" | "settlements";
  code:
    | "missing_field_mapping"
    | "invalid_amount"
    | "missing_transaction_timestamp"
    | "invalid_transaction_timestamp"
    | "missing_settlement_timestamp"
    | "invalid_settlement_timestamp"
    | "fallback_settlement_cycle"
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

export type ProviderWebhookAttempt = {
  id: string;
  providerId: Exclude<ProviderId, "generic">;
  externalEventId: string;
  eventType: string | null;
  signatureVersion: string;
  signatureKeyId: string | null;
  keyState: "active" | "previous" | null;
  outcome: "accepted" | "duplicate" | "rejected" | "conflict" | "failed";
  httpStatus: number;
  failureCode: string | null;
  matchedRecords: number;
  processingMs: number;
  receivedAt: string;
};

export type ProviderWebhookObservability = {
  summary: {
    total: number;
    accepted: number;
    duplicate: number;
    rejected: number;
    conflict: number;
    failed: number;
    previousKeyAccepted: number;
    averageProcessingMs: number | null;
  };
  byProvider: Array<{
    providerId: Exclude<ProviderId, "generic">;
    total: number;
    accepted: number;
    rejected: number;
    previousKeyAccepted: number;
  }>;
  recent: ProviderWebhookAttempt[];
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

export type OperationalNotification = {
  id: string;
  type: "provider_event" | "sla_at_risk" | "sla_overdue";
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  entityType: "operations_case" | "payment_workflow" | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
};

export type ReconciliationStatus =
  | "matched"
  | "amount_mismatch"
  | "missing_settlement"
  | "gateway_missing"
  | "duplicate"
  | "pending";

export type MatchStrategy =
  | "exact_order_id"
  | "gateway_reference_fallback"
  | "amount_date_window"
  | "unmatched";

export type MatchConfidence = "exact" | "high" | "medium" | "low" | "none";

export type ReasonCode =
  | "timing_not_due"
  | "utr_missing"
  | "utr_duplicate"
  | "fee_mismatch"
  | "gst_mismatch"
  | "hold_unexplained"
  | "payout_failed"
  | "chargeback_pending_recovery"
  | "refund_not_adjusted"
  | "unmatched_other"
  | "payout_sum_mismatch"
  | "refund_offset_recognized";

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
  settlementStatus: SettlementTimingStatus;
  transactionAt: string | null;
  transactionTimestampSource: SettlementTimestampSource | null;
  settlementRecordedAt: string | null;
  settlementCycle: SettlementCycle | null;
  expectedSettlementAt: string | null;
  settlementPolicyVersion: string | null;
  settlementCalendarVersion: string | null;
  settlementTimingEvidence: SettlementTimingEvidence | null;
  severity: "low" | "medium" | "high";
  matchStrategy: MatchStrategy;
  matchConfidence: MatchConfidence;
  reasonCode: ReasonCode | null;
  payoutId: string | null;
  summary: string;
  evidence: string[];
  sourceEvidence: SourceEvidence[];
};

// Slice 5 (refund netting). A refund row is detected from the
// settlements CSV via the `transactionType` adapter field and emitted
// as a candidate on the engine result. The post-persist
// `refreshRefundAllocations` hook links each candidate to its parent
// capture item.
export type NormalizedRefundRow = {
  orderId: string;
  amount: number;
  reference: string;
  settlementAt: string | null;
  transactionAt: string | null;
  utr: string | null;
  statementReference: string | null;
  rowNumber?: number;
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
  refundCandidates: NormalizedRefundRow[];
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
  providerId: ProviderId;
  orderId: string;
  gatewayReference: string;
  paymentMode: string;
  orderAmount: number;
  variance: number;
  reconciliationStatus: ReconciliationStatus;
  caseOrigin: OperationsCaseOrigin;
  settlementStatus: SettlementTimingStatus;
  transactionAt: string | null;
  transactionTimestampSource: SettlementTimestampSource | null;
  settlementRecordedAt: string | null;
  settlementCycle: SettlementCycle | null;
  expectedSettlementAt: string | null;
  settlementDaysOverdue: number | null;
  settlementTimingEvidence: SettlementTimingEvidence | null;
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
  itemId: string;
  engineMatchStrategy: MatchStrategy | null;
  engineMatchConfidence: MatchConfidence | null;
  engineReasonCode: ReasonCode | null;
  manualOverride: ManualOverrideSummary | null;
};

export type ManualOverrideSummary = {
  id: string;
  proposalType: "manual_match" | "manual_unmatch";
  status: "applied" | "proposed" | "approved" | "rejected" | "withdrawn";
  reason: string;
  proposedByUserId: string | null;
  proposedByName: string;
  proposedAt: string;
  decidedByUserId: string | null;
  decidedByName: string | null;
  decisionReason: string | null;
  decidedAt: string | null;
};

export type OperationsCaseComment = {
  id: string;
  caseId: string;
  authorName: string;
  body: string;
  createdAt: string;
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
  providerId: ProviderId;
  status: string;
  createdAt: string;
};

export type ReconciliationCloseStatus =
  | "open"
  | "submitted"
  | "approved"
  | "reopened";

export type ReconciliationCloseReadiness = {
  businessDate: string;
  providerId: ProviderId;
  paymentMode: string;
  runCount: number;
  itemCount: number;
  processedValue: number;
  matchedValue: number;
  actionableExceptionCount: number;
  unresolvedCaseCount: number;
  unresolvedExposure: number;
  blockingCaseCount: number;
  settlementPayable: number;
  settlementDeductions: number;
  settlementCredited: number;
  settlementOutstanding: number;
  settlementHeldAmount: number;
  settlementFailedAmount: number;
  unresolvedCountThreshold: number;
  unresolvedAmountThreshold: number;
  ready: boolean;
  blockers: string[];
  unresolvedCases: Array<{
    id: string;
    orderId: string;
    reconciliationStatus: ReconciliationStatus;
    priority: "low" | "medium" | "high";
    exposure: number;
    owner: string | null;
  }>;
};

export type ReconciliationCloseVersion = {
  id: string;
  versionNumber: number;
  snapshotHash: string;
  snapshot: ReconciliationCloseReadiness;
  preparedByName: string;
  preparedAt: string;
  approvedByName: string | null;
  approvedAt: string | null;
  dispositions: Array<{
    caseId: string;
    reason: string;
    evidenceConfirmed: boolean;
  }>;
};

export type ReconciliationClosePeriod = {
  id: string | null;
  businessDate: string;
  providerId: ProviderId;
  paymentMode: string;
  status: ReconciliationCloseStatus;
  unresolvedCountThreshold: number;
  unresolvedAmountThreshold: number;
  reopenedByName: string | null;
  reopenedReason: string | null;
  reopenedAt: string | null;
  activeVersion: ReconciliationCloseVersion | null;
  readiness: ReconciliationCloseReadiness;
};

export type ReconciliationCloseWorkspace = {
  selected: ReconciliationClosePeriod;
  options: {
    providers: ProviderId[];
    paymentModes: string[];
    businessDates: string[];
    scopes: Array<{
      businessDate: string;
      providerId: ProviderId;
      paymentMode: string;
    }>;
  };
  history: ReconciliationClosePeriod[];
};

export type RemediationFingerprint = {
  providerId: ProviderId;
  paymentMode: string;
  reconciliationStatus: Exclude<
    ReconciliationStatus,
    "matched" | "pending"
  >;
  caseOrigin: OperationsCaseOrigin;
};

export type RemediationProgramStatus =
  | "active"
  | "monitoring"
  | "verified"
  | "abandoned";

export type RecurrenceSuggestion = RemediationFingerprint & {
  fingerprint: string;
  caseCount: number;
  exposure: number;
  breachedCases: number;
  openCases: number;
  firstOccurredAt: string;
  lastOccurredAt: string;
  rankScore: number;
  promoted: boolean;
};

export type RemediationCleanRun = {
  runId: string;
  runName: string;
  createdAt: string;
  qualifyingItems: number;
  recurringExceptions: number;
  clean: boolean;
};

export type RemediationProgramEvent = {
  id: string;
  eventType:
    | "program_created"
    | "program_updated"
    | "case_linked"
    | "implementation_started"
    | "program_verified"
    | "program_abandoned";
  actorName: string;
  details: Record<string, unknown>;
  createdAt: string;
};

export type RemediationProgramCase = {
  id: string;
  orderId: string;
  priority: "low" | "medium" | "high";
  status: CaseStatus;
  exposure: number;
  dueAt: string;
  resolvedAt: string | null;
  linkType: "baseline" | "automatic";
  linkedAt: string;
};

export type RemediationProgram = RemediationFingerprint & {
  id: string;
  fingerprint: string;
  status: RemediationProgramStatus;
  ownerUserId: string;
  ownerName: string;
  remediationPlan: string;
  targetDate: string;
  detectionWindowStart: string;
  detectionWindowEnd: string;
  baselineCaseCount: number;
  baselineExposure: number;
  implementationSummary: string | null;
  implementationEvidenceReference: string | null;
  implementedAt: string | null;
  verifiedByName: string | null;
  verifiedAt: string | null;
  abandonedByName: string | null;
  abandonedReason: string | null;
  abandonedAt: string | null;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  linkedCases: RemediationProgramCase[];
  cleanRuns: RemediationCleanRun[];
  events: RemediationProgramEvent[];
};

export type RemediationProgramsWorkspace = {
  summary: {
    suggestedClusters: number;
    recurringExposure: number;
    openPrograms: number;
    verifiedPrograms: number;
  };
  filters: {
    provider: ProviderId | "all";
    paymentMode: string | "all";
    status: RemediationProgramStatus | "all";
  };
  options: {
    providers: ProviderId[];
    paymentModes: string[];
    owners: Array<{ id: string; name: string; role: "admin" | "analyst" }>;
  };
  suggestions: RecurrenceSuggestion[];
  programs: RemediationProgram[];
};

export type InsightsRange = "7d" | "30d" | "90d";

export type InsightsFilters = {
  range: InsightsRange;
  provider: ProviderId | "all";
  paymentMode: string | "all";
  priority: OperationsCase["priority"] | "all";
};

export type OperationsFilters = {
  status: "all" | CaseStatus;
  sla: "all" | "at_risk" | "overdue";
  exception: "all" | ReconciliationStatus;
  provider: "all" | ProviderId;
  paymentMode: "all" | string;
  priority: "all" | OperationsCase["priority"];
  owner: "all" | "assigned" | "unassigned";
  age: "all" | "under_4h" | "4h_24h" | "1d_3d" | "over_3d";
  settlementStatus: "all" | SettlementTimingStatus;
  settlementCycle: "all" | SettlementCycle;
  expectedDate:
    | "all"
    | "today"
    | "next_business_day"
    | "next_3_business_days"
    | "past_due";
  daysOverdue:
    | "all"
    | "under_1d"
    | "1d_2d"
    | "3d_7d"
    | "over_7d";
  query: string;
  caseId: string | null;
};

export type InsightsMetric = {
  value: number | null;
  previousValue: number | null;
  changePercent: number | null;
};

export type InsightsDashboard = {
  filters: InsightsFilters;
  options: {
    providers: ProviderId[];
    paymentModes: string[];
  };
  period: {
    startAt: string;
    endAt: string;
    previousStartAt: string;
    previousEndAt: string;
  };
  hasData: boolean;
  kpis: {
    processedValue: InsightsMetric;
    matchRate: InsightsMetric;
    actionableExceptions: InsightsMetric;
    medianResolutionHours: InsightsMetric;
  };
  currentQueue: {
    active: number;
    atRisk: number;
    overdue: number;
    unassigned: number;
  };
  periodOutcomes: {
    resolvedCases: number;
    slaBreachRate: number | null;
  };
  dailyTrend: Array<{
    date: string;
    orders: number;
    exceptions: number;
    resolved: number;
  }>;
  exceptionMix: Array<{
    status: ReconciliationStatus;
    count: number;
    amount: number;
  }>;
  aging: Array<{
    bucket: "under_4h" | "4h_24h" | "1d_3d" | "over_3d";
    count: number;
  }>;
  providerPerformance: Array<{
    providerId: ProviderId;
    totalOrders: number;
    matchRate: number | null;
    exceptionCount: number;
    processedValue: number;
    timingEligibleSettled: number;
    onTimeSettlements: number;
    lateSettlements: number;
    onTimeSettlementRate: number | null;
    overdueUnsettled: number;
    medianLateDelayHours: number | null;
  }>;
  aiGovernance: {
    investigations: number;
    approvalRate: number | null;
    helpfulnessRate: number | null;
    reviewerDisagreementRate: number | null;
    criticalSafetyFailures: number;
  };
  inboundEvidence: Array<{
    providerId: Exclude<ProviderId, "generic">;
    deliveries: number;
    matchedEvents: number;
  }>;
  rootCausePrograms: {
    openPrograms: number;
    recurringExposure: number;
    verifiedFixes: number;
    recurrenceTrend: Array<{
      date: string;
      linkedCases: number;
    }>;
  };
  merchantSettlements: {
    grossCollected: number;
    totalDeductions: number;
    netPayable: number;
    creditedAmount: number;
    heldAmount: number;
    failedAmount: number;
    forwardDeductions: number;
    utrMatchRate: number | null;
  };
  settlementImports: {
    imports: number;
    importedRows: number;
    exceptions: number;
    openExceptions: number;
    proposedAdjustments: number;
    approvedAdjustments: number;
    exposureAmount: number;
  };
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
