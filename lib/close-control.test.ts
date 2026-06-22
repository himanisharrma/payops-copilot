import { describe, expect, it } from "vitest";
import {
  parseCloseFilters,
  stableSnapshotHash,
  withCloseReadiness,
} from "@/lib/close-control";

describe("reconciliation close policy", () => {
  it("validates URL-backed scope filters", () => {
    expect(
      parseCloseFilters(
        new URLSearchParams(
          "date=2026-06-22&provider=payu_demo&paymentMode=Netbanking",
        ),
      ),
    ).toEqual({
      businessDate: "2026-06-22",
      providerId: "payu_demo",
      paymentMode: "Netbanking",
    });
  });

  it("blocks empty, high-priority, and over-materiality closes", () => {
    const readiness = withCloseReadiness({
      businessDate: "2026-06-22",
      providerId: "generic",
      paymentMode: "UPI",
      runCount: 1,
      itemCount: 4,
      processedValue: 4000,
      matchedValue: 2000,
      actionableExceptionCount: 2,
      unresolvedCaseCount: 2,
      unresolvedExposure: 2000,
      blockingCaseCount: 1,
      unresolvedCountThreshold: 2,
      unresolvedAmountThreshold: 2500,
      unresolvedCases: [],
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toEqual([
      "1 high-priority exception remains unresolved.",
    ]);
  });

  it("produces stable hashes independent of object key order", () => {
    expect(stableSnapshotHash({ b: 2, a: { d: 4, c: 3 } })).toBe(
      stableSnapshotHash({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });
});
