import { describe, expect, it } from "vitest";
import {
  validateBulkAssignment,
  validateCaseComment,
  validateCasePatch,
  validateCaseResolution,
} from "./cases/service";
import {
  adjudicateEvaluation,
  parseEvaluationProvider,
  validateEvaluationReview,
} from "./evaluations/service";
import { DomainError } from "./errors";
import { validateInvestigationReview } from "./investigations/service";
import { validatePaymentWorkflowPatch } from "./payment-workflows/service";
import { validateReconciliationRequest } from "./reconciliation/service";
import type { OperationsCase, PaymentWorkflow } from "../types";

const chargeback = {
  id: "workflow-1",
  type: "chargeback",
  externalReference: "CB-1",
  orderId: "ORD-1",
  paymentReference: "PAY-1",
  amount: 1000,
  reason: "Synthetic dispute",
  status: "evidence_due",
  priority: "high",
  owner: null,
  dueAt: new Date().toISOString(),
  evidenceChecklist: [
    { key: "order", label: "Order", complete: true },
    { key: "response", label: "Response", complete: false },
  ],
  notes: "",
  resolvedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  events: [],
} satisfies PaymentWorkflow;

const resolvableCase = {
  id: "case-1",
  runId: "run-1",
  runName: "Evidence run",
  providerId: "generic",
  caseOrigin: "reconciliation_exception",
  settlementStatus: "settled",
  transactionAt: null,
  transactionTimestampSource: null,
  settlementRecordedAt: null,
  settlementCycle: null,
  expectedSettlementAt: null,
  settlementDaysOverdue: null,
  settlementTimingEvidence: null,
  orderId: "ORD-1",
  gatewayReference: "PAY-1",
  paymentMode: "UPI",
  orderAmount: 1000,
  variance: -10,
  reconciliationStatus: "amount_mismatch",
  summary: "Settlement mismatch.",
  evidence: ["Expected net: ₹990", "Bank settled: ₹980"],
  sourceEvidence: [
    {
      sourceType: "orders",
      rowNumber: 1,
      normalizedValues: { orderId: "ORD-1", amount: 1000 },
      sourceValues: { order_id: "ORD-1", amount: 1000 },
      integrityHash: "a".repeat(64),
    },
  ],
  priority: "high",
  status: "investigating",
  owner: "Analyst",
  notes: "",
  dueAt: new Date().toISOString(),
  resolvedAt: null,
  resolutionReason: null,
  resolutionEvidenceConfirmed: false,
  resolvedByName: null,
  slaStatus: "on_track",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  latestInvestigation: null,
} satisfies OperationsCase;

describe("modular backend services", () => {
  it("validates bounded bulk assignment and append-only comments", () => {
    expect(() =>
      validateBulkAssignment({
        caseIds: [
          "11111111-1111-4111-8111-111111111111",
          "22222222-2222-4222-8222-222222222222",
        ],
        owner: "Asha",
      }),
    ).not.toThrow();
    expect(() =>
      validateBulkAssignment({ caseIds: [], owner: "Asha" }),
    ).toThrow("Select between 1 and 100 cases");
    expect(() =>
      validateBulkAssignment({ caseIds: ["not-a-uuid"], owner: "Asha" }),
    ).toThrow("Select between 1 and 100 cases");
    expect(validateCaseComment({ body: "  Provider trace requested.  " })).toBe(
      "Provider trace requested.",
    );
    expect(() => validateCaseComment({ body: " " })).toThrow(
      "Comment text is required",
    );
  });

  it("accepts valid case changes and rejects invalid values", () => {
    expect(() =>
      validateCasePatch({ status: "investigating", priority: "high" }),
    ).not.toThrow();
    expect(() =>
      validateCasePatch({ status: "invalid" as "open" }),
    ).toThrow(DomainError);
  });

  it("requires durable evidence and an explicit reason to resolve a case", () => {
    expect(() =>
      validateCaseResolution(resolvableCase, {
        status: "resolved",
        resolutionReason: "Provider confirmed the settlement adjustment.",
        resolutionEvidenceConfirmed: true,
      }),
    ).not.toThrow();
    expect(() =>
      validateCaseResolution(
        { ...resolvableCase, sourceEvidence: [] },
        {
          status: "resolved",
          resolutionReason: "Provider confirmed the settlement adjustment.",
          resolutionEvidenceConfirmed: true,
        },
      ),
    ).toThrow("no durable source evidence");
    expect(() =>
      validateCaseResolution(resolvableCase, {
        status: "resolved",
        resolutionReason: "Too short",
        resolutionEvidenceConfirmed: true,
      }),
    ).toThrow("at least 10 characters");
    expect(() =>
      validateCaseResolution(resolvableCase, {
        status: "resolved",
        resolutionReason: "Provider confirmed the settlement adjustment.",
      }),
    ).toThrow("Confirm that the source evidence was reviewed");
  });

  it("keeps chargeback evidence submission behind the completion gate", () => {
    expect(() =>
      validatePaymentWorkflowPatch(chargeback, {
        status: "evidence_submitted",
      }),
    ).toThrow(
      "Complete every evidence check before submitting a chargeback response.",
    );

    expect(() =>
      validatePaymentWorkflowPatch(chargeback, {
        status: "evidence_submitted",
        evidenceChecklist: chargeback.evidenceChecklist.map((item) => ({
          ...item,
          complete: true,
        })),
      }),
    ).not.toThrow();
  });

  it("rejects skipped payment lifecycle stages", () => {
    expect(() =>
      validatePaymentWorkflowPatch(chargeback, { status: "won" }),
    ).toThrow("Cannot move this workflow from evidence_due to won.");
  });

  it("parses deterministic evaluation requests and rejects unknown providers", () => {
    expect(parseEvaluationProvider(undefined)).toBe("deterministic");
    expect(parseEvaluationProvider("deterministic")).toBe("deterministic");
    expect(() => parseEvaluationProvider("unknown")).toThrow(DomainError);
  });

  it("requires all six evaluation review scores from zero to two", () => {
    expect(() =>
      validateEvaluationReview({
        grounding: 2,
        safety: 2,
        uncertainty: 1,
        action: 2,
        providerMessage: 1,
        completeness: 2,
      }),
    ).not.toThrow();
    expect(() =>
      validateEvaluationReview({
        grounding: 3,
        safety: 2,
        uncertainty: 1,
        action: 2,
        providerMessage: 1,
        completeness: 2,
      }),
    ).toThrow(DomainError);
  });

  it("keeps evaluation adjudication administrator-only", async () => {
    await expect(
      adjudicateEvaluation(
        "evaluation-1",
        "case-1",
        {
          scores: {
            grounding: 2,
            safety: 2,
            uncertainty: 2,
            action: 2,
            providerMessage: 2,
            completeness: 2,
          },
        },
        {
          id: "analyst-1",
          name: "Analyst",
          role: "analyst",
          organizationId: "organization-1",
          organizationName: "Organization",
        },
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("accepts valid investigation review changes", () => {
    expect(() =>
      validateInvestigationReview({
        approvalStatus: "approved",
        feedbackRating: "helpful",
        feedbackNotes: "Grounded in the supplied evidence.",
      }),
    ).not.toThrow();
  });

  it("rejects empty and invalid investigation review changes", () => {
    expect(() => validateInvestigationReview(null)).toThrow(
      "Investigation review must be an object.",
    );
    expect(() => validateInvestigationReview({})).toThrow(DomainError);
    expect(() => validateInvestigationReview({ unsupported: true })).toThrow(
      "Provide an investigation review change.",
    );
    expect(() =>
      validateInvestigationReview({
        approvalStatus: "accepted" as "approved",
      }),
    ).toThrow("Invalid approval.");
  });

  it("accepts valid reconciliation requests", () => {
    expect(() =>
      validateReconciliationRequest({
        orders: [{ order_id: "ORD-1" }],
        gateway: [],
        settlements: [],
        providerId: "razorpay_demo",
        sourceType: "demo",
      }),
    ).not.toThrow();
  });

  it("rejects malformed reconciliation requests", () => {
    expect(() => validateReconciliationRequest(null)).toThrow(
      "Reconciliation request must be an object.",
    );
    expect(() =>
      validateReconciliationRequest({
        orders: [],
        gateway: [],
      }),
    ).toThrow("Orders, gateway, and settlement records are required.");
    expect(() =>
      validateReconciliationRequest({
        orders: [],
        gateway: [],
        settlements: [],
        sourceType: "provider" as "demo",
      }),
    ).toThrow("Source type must be demo or upload.");
    expect(() =>
      validateReconciliationRequest({
        orders: [],
        gateway: [],
        settlements: [],
        providerId: "live_gateway" as "generic",
      }),
    ).toThrow("Unsupported provider adapter.");
  });
});
