import { describe, expect, it } from "vitest";
import { fallbackInvestigation } from "./ai-investigator";
import type { OperationsCase } from "./types";

const paymentCase: OperationsCase = {
  id: "case-1",
  runId: "run-1",
  runName: "Demo run",
  orderId: "ORD-1",
  gatewayReference: "PAY-1",
  paymentMode: "UPI",
  orderAmount: 1000,
  variance: -100,
  reconciliationStatus: "amount_mismatch",
  summary: "Settlement is short by ₹100.",
  evidence: ["Expected net: ₹900", "Bank settled: ₹800"],
  priority: "high",
  status: "open",
  owner: null,
  notes: "",
  dueAt: "2026-06-12T04:00:00.000Z",
  resolvedAt: null,
  slaStatus: "overdue",
  createdAt: "2026-06-12T00:00:00.000Z",
  updatedAt: "2026-06-12T00:00:00.000Z",
  latestInvestigation: null,
};

describe("fallbackInvestigation", () => {
  it("grounds the analysis and provider draft in supplied evidence", () => {
    const result = fallbackInvestigation(paymentCase);

    expect(result.supportingEvidence).toEqual(paymentCase.evidence);
    expect(result.providerMessage).toContain("ORD-1");
    expect(result.providerMessage).toContain("PAY-1");
    expect(result.providerMessage).toContain("No financial action has been taken");
  });

  it("states limitations instead of claiming provider-side certainty", () => {
    const result = fallbackInvestigation(paymentCase);

    expect(result.confidence).toBe("medium");
    expect(result.limitations.join(" ")).toContain("cannot confirm");
  });
});
