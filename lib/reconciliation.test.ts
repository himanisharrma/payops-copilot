import { describe, expect, it } from "vitest";
import { reconcilePayments } from "./reconciliation";

describe("reconcilePayments", () => {
  it("matches a payment when order, fee, tax, and settlement agree", () => {
    const result = reconcilePayments({
      orders: [{ order_id: "ORD-1", amount: 1000, payment_mode: "UPI" }],
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
});
