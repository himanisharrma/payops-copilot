import { describe, expect, it } from "vitest";
import { reconcilePayments } from "./reconciliation";

describe("reconcilePayments", () => {
  it("matches a payment when order, fee, tax, and settlement agree", () => {
    const result = reconcilePayments({
      orders: [
        {
          order_id: "ORD-1",
          amount: 1000,
          payment_mode: "UPI",
          customer_email: "synthetic@example.test",
        },
      ],
      gateway: [
        {
          merchant_order_id: "ORD-1",
          payment_id: "PAY-1",
          transaction_amount: 1000,
          txn_status: "captured",
          mdr: 10,
          gst: 1.8,
        },
      ],
      settlements: [
        {
          orderid: "ORD-1",
          gateway_reference: "PAY-1",
          net_settlement: 988.2,
          settlement_utr: "UTR-1",
        },
      ],
    });

    expect(result.items[0].status).toBe("matched");
    expect(result.summary.matchRate).toBe(100);
    expect(result.items[0].sourceEvidence).toHaveLength(3);
    expect(result.items[0].sourceEvidence[0]).toMatchObject({
      sourceType: "orders",
      rowNumber: 1,
      normalizedValues: { orderId: "ORD-1", amount: 1000 },
    });
    expect(result.items[0].sourceEvidence[0].integrityHash).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(result.items[0].sourceEvidence[0].sourceValues).not.toHaveProperty(
      "customer_email",
    );
  });

  it("flags a successful payment with no settlement", () => {
    const result = reconcilePayments({
      orders: [{ order_id: "ORD-2", amount: 500 }],
      gateway: [
        {
          merchant_order_id: "ORD-2",
          transaction_amount: 500,
          txn_status: "captured",
          mdr: 5,
          gst: 0.9,
        },
      ],
      settlements: [],
    });

    expect(result.items[0].status).toBe("missing_settlement");
    expect(result.items[0].expectedNet).toBe(494.1);
    expect(result.items[0].sourceEvidence.map((item) => item.sourceType)).toEqual(
      ["orders", "gateway"],
    );
    expect(result.items[0].settlementStatus).toBe("timing_unavailable");
    expect(result.summary.exceptionCount).toBe(0);
  });

  it("defers missing settlements until the calculated deadline passes", () => {
    const request = {
      providerId: "generic" as const,
      orders: [
        {
          order_id: "ORD-CLOCK",
          amount: 500,
          payment_mode: "UPI",
          created_at: "2026-06-22T10:00:00+05:30",
        },
      ],
      gateway: [
        {
          merchant_order_id: "ORD-CLOCK",
          payment_id: "PAY-CLOCK",
          transaction_amount: 500,
          payment_method: "UPI",
          txn_status: "captured",
          captured_at: "2026-06-22T10:05:00+05:30",
        },
      ],
      settlements: [],
    };
    const notDue = reconcilePayments(
      request,
      "2026-06-22T11:00:00+05:30",
    );
    expect(notDue.items[0]).toMatchObject({
      status: "missing_settlement",
      settlementStatus: "due_today",
      settlementCycle: "T+0",
    });
    expect(notDue.summary.exceptionCount).toBe(0);

    const overdue = reconcilePayments(
      request,
      "2026-06-22T18:00:00.001+05:30",
    );
    expect(overdue.items[0].settlementStatus).toBe("overdue");
    expect(overdue.summary.exceptionCount).toBe(1);
  });

  it("normalizes common column aliases and detects amount variance", () => {
    const result = reconcilePayments({
      orders: [{ "Order ID": "ORD-3", "Order Amount": "₹2,000" }],
      gateway: [
        {
          orderid: "ORD-3",
          txn_amount: "2000",
          status: "success",
          fee: "20",
          tax: "3.60",
        },
      ],
      settlements: [
        {
          order_id: "ORD-3",
          settled_amount: "1900",
        },
      ],
    });

    expect(result.items[0].status).toBe("amount_mismatch");
    expect(result.items[0].variance).toBe(-76.4);
  });

  it("uses provider-specific aliases and exposes the selected adapter", () => {
    const result = reconcilePayments({
      providerId: "cashfree_demo",
      orders: [{ cf_order_id: "CF-1", order_amount: 1200 }],
      gateway: [
        {
          cf_order_id: "CF-1",
          cf_payment_id: "CFPAY-1",
          payment_amount: 1200,
          payment_status: "SUCCESS",
          payment_group: "UPI",
          service_charge: 12,
          service_tax: 2.16,
        },
      ],
      settlements: [
        {
          cf_order_id: "CF-1",
          cf_payment_id: "CFPAY-1",
          settlement_amount: 1185.84,
          transfer_utr: "UTR-CF-1",
        },
      ],
    });

    expect(result.providerReport?.providerId).toBe("cashfree_demo");
    expect(result.items[0].status).toBe("matched");
    expect(result.items[0].paymentMode).toBe("UPI");
  });

  it("reports provider data-quality issues without blocking reconciliation", () => {
    const result = reconcilePayments({
      providerId: "payu_demo",
      orders: [{ txnid: "PU-1", amount: "₹1,000" }],
      gateway: [
        {
          txnid: "PU-1",
          mihpayid: "PAYU-1",
          amount: "not-a-number",
          status: "queued",
        },
      ],
      settlements: [],
    });

    expect(result.providerReport?.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["invalid_amount", "unknown_status"]),
    );
    expect(result.items[0].status).toBe("pending");
  });
});
