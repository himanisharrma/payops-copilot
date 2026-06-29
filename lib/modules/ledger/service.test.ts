import { describe, expect, it } from "vitest";
import {
  assertBalanced,
  bankCreditToPlan,
  captureToPlan,
  feeToPlan,
  gstToPlan,
  payoutToPlan,
  refundNettingToPlan,
} from "./posting-recipes";

const baseDate = new Date("2026-06-29T18:30:00Z");

describe("posting recipes — balanced pairs", () => {
  it("captureToPlan: debit provider_receivable, credit merchant_payable", () => {
    const plan = captureToPlan({
      sourceItemId: "11111111-1111-1111-1111-111111111111",
      merchantAccountId: "22222222-2222-2222-2222-222222222222",
      provider: "razorpay_demo",
      grossAmount: 100,
      effectiveAt: baseDate,
      externalRefs: { orderId: "ORD-1", gatewayReference: "PAY-1" },
    });
    expect(plan.sourceType).toBe("capture");
    expect(plan.idempotencyKey).toBe(
      "capture:11111111-1111-1111-1111-111111111111",
    );
    expect(plan.entries).toEqual([
      { accountRole: "provider_receivable", provider: "razorpay_demo", direction: "debit", amount: 100 },
      { accountRole: "merchant_payable", provider: null, direction: "credit", amount: 100 },
    ]);
    expect(() => assertBalanced(plan)).not.toThrow();
  });

  it("feeToPlan (MDR ₹2): debit fee_expense, credit provider_receivable", () => {
    const plan = feeToPlan({
      deduction: {
        sourceDeductionId: "33333333-3333-3333-3333-333333333333",
        type: "mdr",
        amount: 2,
        taxAmount: 0,
      },
      batchId: "44444444-4444-4444-4444-444444444444",
      provider: "cashfree_demo",
      effectiveAt: baseDate,
      utr: "UTR-X",
    });
    expect(plan.idempotencyKey).toBe(
      "fee:33333333-3333-3333-3333-333333333333:2.00",
    );
    expect(plan.entries).toEqual([
      { accountRole: "fee_expense", provider: "cashfree_demo", direction: "debit", amount: 2 },
      { accountRole: "provider_receivable", provider: "cashfree_demo", direction: "credit", amount: 2 },
    ]);
    expect(() => assertBalanced(plan)).not.toThrow();
  });

  it("gstToPlan (₹0.36): debit gst_liability, credit provider_receivable", () => {
    const plan = gstToPlan({
      deduction: {
        sourceDeductionId: "55555555-5555-5555-5555-555555555555",
        type: "gst",
        amount: 0.36,
        taxAmount: 0,
      },
      batchId: "44444444-4444-4444-4444-444444444444",
      provider: "razorpay_demo",
      effectiveAt: baseDate,
      utr: null,
    });
    expect(plan.entries[0].direction).toBe("debit");
    expect(plan.entries[0].accountRole).toBe("gst_liability");
    expect(plan.entries[0].provider).toBeNull();
    expect(plan.entries[1].accountRole).toBe("provider_receivable");
    expect(plan.entries[1].provider).toBe("razorpay_demo");
    expect(() => assertBalanced(plan)).not.toThrow();
  });

  it("bankCreditToPlan (₹97.64): debit escrow_cash, credit provider_receivable", () => {
    const plan = bankCreditToPlan({
      credit: {
        sourceBankCreditId: "66666666-6666-6666-6666-666666666666",
        amount: 97.64,
        creditedAt: baseDate,
      },
      batchId: "44444444-4444-4444-4444-444444444444",
      provider: "razorpay_demo",
      utr: "UTR-XYZ",
    });
    expect(plan.entries).toEqual([
      { accountRole: "escrow_cash", provider: null, direction: "debit", amount: 97.64 },
      { accountRole: "provider_receivable", provider: "razorpay_demo", direction: "credit", amount: 97.64 },
    ]);
    expect(() => assertBalanced(plan)).not.toThrow();
  });

  it("payoutToPlan (₹97.64): debit merchant_payable, credit escrow_cash", () => {
    const plan = payoutToPlan({
      batchId: "44444444-4444-4444-4444-444444444444",
      amount: 97.64,
      provider: "razorpay_demo",
      effectiveAt: baseDate,
      utr: "UTR-XYZ",
    });
    expect(plan.entries).toEqual([
      { accountRole: "merchant_payable", provider: null, direction: "debit", amount: 97.64 },
      { accountRole: "escrow_cash", provider: null, direction: "credit", amount: 97.64 },
    ]);
    expect(() => assertBalanced(plan)).not.toThrow();
  });

  it("refundNettingToPlan (₹50): debit merchant_payable, credit provider_receivable", () => {
    // v1 collapses initiation + netting into one transaction (we only
    // see the refund at settlement time). DR merchant_payable reduces
    // what we owe the merchant; CR provider_receivable reduces what
    // the PG owes us (they paid the customer on our behalf).
    // refund_payable is reserved for v1.1's refund_initiation source.
    const plan = refundNettingToPlan({
      allocationId: "77777777-7777-7777-7777-777777777777",
      merchantAccountId: "22222222-2222-2222-2222-222222222222",
      provider: "generic",
      amount: 50,
      effectiveAt: baseDate,
      externalRefs: { refundOrderId: "ORD-1", refundExternalReference: "REF-1" },
    });
    expect(plan.idempotencyKey).toBe(
      "refund_netting:77777777-7777-7777-7777-777777777777",
    );
    expect(plan.entries).toEqual([
      { accountRole: "merchant_payable", provider: null, direction: "debit", amount: 50 },
      { accountRole: "provider_receivable", provider: "generic", direction: "credit", amount: 50 },
    ]);
    expect(() => assertBalanced(plan)).not.toThrow();
  });
});

describe("assertBalanced", () => {
  it("rejects plans with <2 entries", () => {
    expect(() =>
      assertBalanced({
        sourceType: "adjustment",
        sourceId: null,
        sourceBatchId: null,
        externalRefs: {},
        effectiveAt: baseDate,
        idempotencyKey: "x",
        description: "",
        entries: [
          { accountRole: "merchant_payable", provider: null, direction: "debit", amount: 1 },
        ],
      }),
    ).toThrow(/needs >=2 entries/);
  });

  it("rejects plans whose debit / credit sums differ", () => {
    expect(() =>
      assertBalanced({
        sourceType: "adjustment",
        sourceId: null,
        sourceBatchId: null,
        externalRefs: {},
        effectiveAt: baseDate,
        idempotencyKey: "x",
        description: "",
        entries: [
          { accountRole: "merchant_payable", provider: null, direction: "debit", amount: 100 },
          { accountRole: "escrow_cash", provider: null, direction: "credit", amount: 99.99 },
        ],
      }),
    ).toThrow(/Σdebit=100, Σcredit=99\.99/);
  });

  it("rejects entries with non-positive amounts", () => {
    expect(() =>
      assertBalanced({
        sourceType: "adjustment",
        sourceId: null,
        sourceBatchId: null,
        externalRefs: {},
        effectiveAt: baseDate,
        idempotencyKey: "x",
        description: "",
        entries: [
          { accountRole: "merchant_payable", provider: null, direction: "debit", amount: 0 },
          { accountRole: "escrow_cash", provider: null, direction: "credit", amount: 0 },
        ],
      }),
    ).toThrow(/amount must be > 0/);
  });
});

describe("idempotency-key determinism", () => {
  it("captureToPlan: same source → same key", () => {
    const a = captureToPlan({
      sourceItemId: "abc",
      merchantAccountId: "m",
      provider: "razorpay_demo",
      grossAmount: 100,
      effectiveAt: baseDate,
      externalRefs: { orderId: "O", gatewayReference: "G" },
    });
    const b = captureToPlan({
      sourceItemId: "abc",
      merchantAccountId: "m",
      provider: "razorpay_demo",
      grossAmount: 100,
      effectiveAt: new Date("2030-01-01"),
      externalRefs: { orderId: "different", gatewayReference: "G2" },
    });
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
  });

  it("feeToPlan: amount drift produces a fresh key (mutation safety)", () => {
    const a = feeToPlan({
      deduction: { sourceDeductionId: "d1", type: "mdr", amount: 2, taxAmount: 0 },
      batchId: "b",
      provider: "razorpay_demo",
      effectiveAt: baseDate,
      utr: null,
    });
    const b = feeToPlan({
      deduction: { sourceDeductionId: "d1", type: "mdr", amount: 2.5, taxAmount: 0 },
      batchId: "b",
      provider: "razorpay_demo",
      effectiveAt: baseDate,
      utr: null,
    });
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
  });
});

