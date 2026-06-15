import { describe, expect, it } from "vitest";
import { validateCasePatch } from "./cases/service";
import {
  parseEvaluationProvider,
  validateEvaluationReview,
} from "./evaluations/service";
import { DomainError } from "./errors";
import { validateInvestigationReview } from "./investigations/service";
import { validatePaymentWorkflowPatch } from "./payment-workflows/service";
import type { PaymentWorkflow } from "../types";

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

describe("modular backend services", () => {
  it("accepts valid case changes and rejects invalid values", () => {
    expect(() =>
      validateCasePatch({ status: "investigating", priority: "high" }),
    ).not.toThrow();
    expect(() =>
      validateCasePatch({ status: "invalid" as "open" }),
    ).toThrow(DomainError);
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
});
