import { describe, expect, it } from "vitest";
import {
  calculateExpectedSettlement,
  classifySettlement,
  getSettlementPolicy,
  isCaseActionable,
  parseExplicitOffsetTimestamp,
  settlementDaysOverdue,
  settlementDelayHours,
} from "./settlement-policy";

describe("settlement policy", () => {
  it("accepts only valid ISO timestamps with an explicit offset", () => {
    expect(
      parseExplicitOffsetTimestamp("2026-06-19T14:45:00+05:30")?.toISOString(),
    ).toBe("2026-06-19T09:15:00.000Z");
    expect(parseExplicitOffsetTimestamp("2026-06-19T14:45:00")).toBeNull();
    expect(
      parseExplicitOffsetTimestamp("2026-02-30T14:45:00+05:30"),
    ).toBeNull();
  });

  it("selects provider and payment-mode cycles with a T+2 fallback", () => {
    expect(getSettlementPolicy("generic", "UPI").cycle).toBe("T+0");
    expect(getSettlementPolicy("cashfree_demo", "Card").cycle).toBe("T+1");
    expect(getSettlementPolicy("payu_demo", "net banking").cycle).toBe("T+2");
    expect(getSettlementPolicy("razorpay_demo", "Crypto")).toMatchObject({
      cycle: "T+2",
      usedFallback: true,
    });
  });

  it("calculates T+0 before cutoff and moves after-cutoff captures", () => {
    const before = calculateExpectedSettlement({
      providerId: "generic",
      paymentMode: "UPI",
      transactionAt: "2026-06-19T15:00:00+05:30",
      transactionTimestampSource: "gateway_capture",
    });
    expect(before.expectedSettlementAt?.toISOString()).toBe(
      "2026-06-19T12:30:00.000Z",
    );

    const after = calculateExpectedSettlement({
      providerId: "generic",
      paymentMode: "UPI",
      transactionAt: "2026-06-19T15:00:00.001+05:30",
      transactionTimestampSource: "gateway_capture",
    });
    expect(after.expectedSettlementAt?.toISOString()).toBe(
      "2026-06-22T12:30:00.000Z",
    );
    expect(after.evidence).toMatchObject({
      afterCaptureCutoff: true,
      cycleAnchorDate: "2026-06-22",
      skippedNonBusinessDates: ["2026-06-20", "2026-06-21"],
    });
  });

  it("applies T+1 and T+2 across weekends and synthetic closures", () => {
    const weekend = calculateExpectedSettlement({
      providerId: "razorpay_demo",
      paymentMode: "UPI",
      transactionAt: "2026-06-19T10:00:00+05:30",
      transactionTimestampSource: "order_created",
    });
    expect(weekend.expectedSettlementAt?.toISOString()).toBe(
      "2026-06-22T12:30:00.000Z",
    );

    const closure = calculateExpectedSettlement({
      providerId: "payu_demo",
      paymentMode: "Card",
      transactionAt: "2026-08-14T10:00:00+05:30",
      transactionTimestampSource: "gateway_capture",
    });
    expect(closure.expectedSettlementAt?.toISOString()).toBe(
      "2026-08-19T12:30:00.000Z",
    );
    expect(closure.evidence?.skippedNonBusinessDates).toEqual([
      "2026-08-15",
      "2026-08-16",
      "2026-08-17",
    ]);
  });

  it("returns timing unavailable for missing or invalid timestamps", () => {
    expect(
      calculateExpectedSettlement({
        providerId: "generic",
        paymentMode: "UPI",
        transactionAt: null,
        transactionTimestampSource: "order_created",
      }).expectedSettlementAt,
    ).toBeNull();
    expect(
      calculateExpectedSettlement({
        providerId: "generic",
        paymentMode: "UPI",
        transactionAt: "2026-06-19 10:00:00",
        transactionTimestampSource: "order_created",
      }).evidence,
    ).toBeNull();
  });

  it("classifies boundary instants with an injected clock", () => {
    const expectedSettlementAt = "2026-06-22T12:30:00.000Z";
    expect(
      classifySettlement({
        hasSettlementRecord: false,
        expectedSettlementAt,
        now: "2026-06-21T12:30:00.000Z",
      }),
    ).toBe("not_due");
    expect(
      classifySettlement({
        hasSettlementRecord: false,
        expectedSettlementAt,
        now: "2026-06-22T12:29:59.999Z",
      }),
    ).toBe("due_today");
    expect(
      classifySettlement({
        hasSettlementRecord: false,
        expectedSettlementAt,
        now: expectedSettlementAt,
      }),
    ).toBe("due_today");
    expect(
      classifySettlement({
        hasSettlementRecord: false,
        expectedSettlementAt,
        now: "2026-06-22T12:30:00.001Z",
      }),
    ).toBe("overdue");
    expect(
      classifySettlement({
        hasSettlementRecord: true,
        expectedSettlementAt: null,
        now: "2026-06-22T12:30:00.001Z",
      }),
    ).toBe("settled");
    expect(
      classifySettlement({
        hasSettlementRecord: false,
        expectedSettlementAt: null,
        now: "2026-06-22T12:30:00.001Z",
      }),
    ).toBe("timing_unavailable");
  });

  it("calculates signed delay and non-negative overdue age", () => {
    expect(
      settlementDelayHours({
        expectedSettlementAt: "2026-06-22T12:30:00.000Z",
        settlementRecordedAt: "2026-06-22T14:00:00.000Z",
      }),
    ).toBe(1.5);
    expect(
      settlementDaysOverdue({
        expectedSettlementAt: "2026-06-22T12:30:00.000Z",
        now: "2026-06-24T00:30:00.000Z",
      }),
    ).toBe(1.5);
    expect(
      settlementDaysOverdue({
        expectedSettlementAt: "2026-06-22T12:30:00.000Z",
        now: "2026-06-21T12:30:00.000Z",
      }),
    ).toBe(0);
  });

  it("gates only missing settlements on settlement lateness", () => {
    expect(
      isCaseActionable({
        reconciliationStatus: "missing_settlement",
        settlementStatus: "overdue",
      }),
    ).toBe(true);
    for (const status of [
      "not_due",
      "due_today",
      "settled",
      "timing_unavailable",
    ] as const) {
      expect(
        isCaseActionable({
          reconciliationStatus: "missing_settlement",
          settlementStatus: status,
        }),
      ).toBe(false);
    }
    expect(
      isCaseActionable({
        reconciliationStatus: "amount_mismatch",
        settlementStatus: "settled",
      }),
    ).toBe(true);
    expect(
      isCaseActionable({ reconciliationStatus: "pending" }),
    ).toBe(false);
  });
});
