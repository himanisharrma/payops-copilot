import { describe, expect, it } from "vitest";
import {
  canSubmitChargebackEvidence,
  canTransitionWorkflow,
  checklistProgress,
  isWorkflowStatus,
  terminalWorkflowStatuses,
  workflowStatuses,
} from "./payment-workflow";
import type { PaymentWorkflow } from "./types";

describe("refund and chargeback workflow policy", () => {
  it("keeps refund and chargeback lifecycle states separate", () => {
    expect(isWorkflowStatus("refund", "processing")).toBe(true);
    expect(isWorkflowStatus("refund", "evidence_due")).toBe(false);
    expect(isWorkflowStatus("chargeback", "evidence_due")).toBe(true);
    expect(isWorkflowStatus("chargeback", "approved")).toBe(false);
  });

  it("defines terminal states for both workflows", () => {
    expect(terminalWorkflowStatuses.has("completed")).toBe(true);
    expect(terminalWorkflowStatuses.has("won")).toBe(true);
    expect(terminalWorkflowStatuses.has("processing")).toBe(false);
  });

  it("calculates evidence completion", () => {
    const workflow = {
      evidenceChecklist: [
        { key: "one", label: "One", complete: true },
        { key: "two", label: "Two", complete: false },
        { key: "three", label: "Three", complete: true },
        { key: "four", label: "Four", complete: false },
      ],
    } as PaymentWorkflow;

    expect(checklistProgress(workflow)).toEqual({
      complete: 2,
      total: 4,
      percent: 50,
    });
  });

  it("exposes every supported status through the policy", () => {
    expect(workflowStatuses.refund).toHaveLength(5);
    expect(workflowStatuses.chargeback).toHaveLength(6);
  });

  it("gates chargeback submission on complete evidence", () => {
    const workflow = {
      type: "chargeback",
      evidenceChecklist: [
        { key: "one", label: "One", complete: true },
        { key: "two", label: "Two", complete: false },
      ],
    } as PaymentWorkflow;

    expect(canSubmitChargebackEvidence(workflow)).toBe(false);
    workflow.evidenceChecklist[1].complete = true;
    expect(canSubmitChargebackEvidence(workflow)).toBe(true);
  });

  it("prevents skipping lifecycle stages", () => {
    expect(canTransitionWorkflow("received", "evidence_due")).toBe(true);
    expect(canTransitionWorkflow("received", "won")).toBe(false);
    expect(canTransitionWorkflow("approved", "processing")).toBe(true);
    expect(canTransitionWorkflow("approved", "completed")).toBe(false);
  });
});
