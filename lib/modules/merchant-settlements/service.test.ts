import { describe, expect, it } from "vitest";
import {
  calculateSettlementArithmetic,
  classifyUtr,
} from "@/lib/modules/merchant-settlements/service";

describe("merchant settlement arithmetic", () => {
  it("computes gross, deductions, net, bank credit, and variance using cents", () => {
    expect(
      calculateSettlementArithmetic({
        grossAmounts: [100.1, "200.20"],
        deductions: ["10.05", 0.05],
        bankCredits: [290.2],
      }),
    ).toEqual({
      grossAmount: 300.3,
      deductionAmount: 10.1,
      netAmount: 290.2,
      bankCreditAmount: 290.2,
      varianceAmount: 0,
    });
  });

  it("rejects deductions greater than gross collections", () => {
    expect(() =>
      calculateSettlementArithmetic({
        grossAmounts: [100],
        deductions: [101],
      }),
    ).toThrow("Settlement deductions cannot exceed gross amount.");
  });
});

describe("merchant settlement UTR classifier", () => {
  const now = new Date("2026-06-25T12:00:00.000Z");

  it("classifies a single exact bank credit as matched", () => {
    expect(
      classifyUtr({
        utr: "UTR-001",
        netAmount: 500,
        bankCredits: [{ utr: "UTR-001", amount: 500 }],
        expectedSettlementAt: "2026-06-24T12:00:00.000Z",
        now,
      }),
    ).toMatchObject({
      status: "matched",
      settlementStatus: "credited",
      bankCreditAmount: 500,
      varianceAmount: 0,
    });
  });

  it("classifies duplicate UTRs before amount checks", () => {
    expect(
      classifyUtr({
        utr: "UTR-DUP",
        netAmount: 500,
        bankCredits: [
          { utr: "UTR-DUP", amount: 250 },
          { utr: "UTR-DUP", amount: 250 },
        ],
        expectedSettlementAt: "2026-06-24T12:00:00.000Z",
        now,
      }).status,
    ).toBe("duplicate_utr");
  });

  it("classifies overdue missing credits separately from missing UTR", () => {
    expect(
      classifyUtr({
        utr: "UTR-LATE",
        netAmount: 500,
        bankCredits: [],
        expectedSettlementAt: "2026-06-24T12:00:00.000Z",
        now,
      }).status,
    ).toBe("delayed_credit");

    expect(
      classifyUtr({
        utr: null,
        netAmount: 500,
        bankCredits: [],
        expectedSettlementAt: "2026-06-24T12:00:00.000Z",
        now,
      }).status,
    ).toBe("missing_utr");
  });

  it("classifies failed retries deterministically", () => {
    expect(
      classifyUtr({
        status: "failed",
        retryCount: 3,
        utr: "UTR-FAILED",
        netAmount: 500,
        bankCredits: [],
        expectedSettlementAt: "2026-06-24T12:00:00.000Z",
        now,
      }).status,
    ).toBe("retry_exhausted");
  });
});
