import { describe, expect, it } from "vitest";
import {
  deterministicExposure,
  rankRecurrence,
  recurrenceWindow,
  remediationFingerprint,
} from "@/lib/remediation-programs";

describe("recurring exception policy", () => {
  it("creates a stable normalized fingerprint", () => {
    expect(
      remediationFingerprint({
        providerId: "razorpay_demo",
        paymentMode: " UPI ",
        reconciliationStatus: "missing_settlement",
        caseOrigin: "settlement_overdue",
      }),
    ).toBe(
      "razorpay_demo|upi|missing_settlement|settlement_overdue",
    );
  });

  it("uses deterministic financial exposure by exception type", () => {
    expect(
      deterministicExposure({
        reconciliationStatus: "amount_mismatch",
        variance: -125.5,
        orderAmount: 4000,
      }),
    ).toBe(125.5);
    expect(
      deterministicExposure({
        reconciliationStatus: "duplicate",
        variance: 0,
        orderAmount: 4000,
      }),
    ).toBe(4000);
  });

  it("ranks count, exposure, breaches, and recency deterministically", () => {
    const recent = rankRecurrence({
      caseCount: 4,
      exposure: 10000,
      breachedCases: 1,
      lastOccurredAt: new Date().toISOString(),
    });
    const older = rankRecurrence({
      caseCount: 3,
      exposure: 5000,
      breachedCases: 0,
      lastOccurredAt: new Date(Date.now() - 20 * 86_400_000).toISOString(),
    });
    expect(recent).toBeGreaterThan(older);
  });

  it("uses an exact trailing 30-day window", () => {
    const now = new Date("2026-06-23T12:00:00.000Z");
    expect(recurrenceWindow(now)).toEqual({
      startAt: new Date("2026-05-24T12:00:00.000Z"),
      endAt: now,
    });
  });
});
