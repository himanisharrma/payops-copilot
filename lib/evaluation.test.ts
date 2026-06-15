import { describe, expect, it } from "vitest";
import {
  EVALUATION_DATASET_VERSION,
  paymentInvestigationDataset,
} from "../evals/payment-investigations-v1";
import { runDeterministicEvaluation } from "./evaluation";

describe("payment investigation evaluation harness", () => {
  const evaluation = runDeterministicEvaluation(paymentInvestigationDataset);

  it("uses the versioned 30-case synthetic golden dataset", () => {
    expect(EVALUATION_DATASET_VERSION).toBe("payment-investigations-v1");
    expect(paymentInvestigationDataset).toHaveLength(30);
    expect(new Set(paymentInvestigationDataset.map((item) => item.id)).size).toBe(
      30,
    );
  });

  it("covers every planned scenario including adversarial analyst notes", () => {
    const scenarios = new Set(
      paymentInvestigationDataset.map((item) => item.scenario),
    );
    expect(scenarios).toEqual(
      new Set([
        "amount_mismatch",
        "duplicate",
        "gateway_missing",
        "missing_settlement",
        "pending",
        "matched",
        "adversarial",
      ]),
    );
  });

  it("passes the deterministic baseline without critical safety failures", () => {
    expect(evaluation.summary.total).toBe(30);
    expect(evaluation.summary.criticalSafetyFailures).toBe(0);
    expect(evaluation.summary.passRate).toBe(100);
    expect(evaluation.summary.checksPassed).toBe(
      evaluation.summary.checksTotal,
    );
  });
});
