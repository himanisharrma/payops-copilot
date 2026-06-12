import type {
  RawRecord,
  ReconciliationItem,
  ReconciliationRequest,
  ReconciliationResult,
} from "./types";

const aliases = {
  orderId: ["order_id", "orderid", "merchant_order_id", "merchantorderid"],
  amount: ["amount", "order_amount", "txn_amount", "transaction_amount", "gross_amount"],
  status: ["status", "payment_status", "txn_status", "transaction_status"],
  paymentMode: ["payment_mode", "paymentmethod", "payment_method", "mode"],
  gatewayReference: ["gateway_ref", "gateway_reference", "payment_id", "txn_id", "transaction_id"],
  settledAmount: ["settled_amount", "net_amount", "settlement_amount", "net_settlement"],
  fee: ["fee", "mdr", "gateway_fee", "processing_fee"],
  tax: ["tax", "gst", "fee_tax"],
  utr: ["utr", "bank_reference", "bank_ref", "settlement_utr"],
};

function normalizedKey(key: string) {
  return key.toLowerCase().trim().replace(/[\s-]+/g, "_");
}

function read(record: RawRecord, keys: string[]) {
  const normalized = Object.fromEntries(
    Object.entries(record).map(([key, value]) => [normalizedKey(key), value]),
  );
  const match = keys.find((key) => normalized[key] !== undefined);
  return match ? normalized[match] : undefined;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function money(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/[₹,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function cents(value: number) {
  return Math.round(value * 100) / 100;
}

function isSuccessful(status: string) {
  return ["captured", "success", "successful", "paid", "settled"].includes(
    status.toLowerCase(),
  );
}

export function reconcilePayments({
  orders,
  gateway,
  settlements,
}: ReconciliationRequest): ReconciliationResult {
  const gatewayRows = gateway.map((row) => ({
    raw: row,
    orderId: text(read(row, aliases.orderId)),
    reference: text(read(row, aliases.gatewayReference)),
    amount: money(read(row, aliases.amount)),
    status: text(read(row, aliases.status)),
    mode: text(read(row, aliases.paymentMode)) || "Unknown",
    fee: money(read(row, aliases.fee)),
    tax: money(read(row, aliases.tax)),
  }));

  const settlementRows = settlements.map((row) => ({
    raw: row,
    orderId: text(read(row, aliases.orderId)),
    reference: text(read(row, aliases.gatewayReference)),
    settledAmount: money(read(row, aliases.settledAmount)),
    utr: text(read(row, aliases.utr)),
    status: text(read(row, aliases.status)),
  }));

  const orderCounts = new Map<string, number>();
  for (const row of gatewayRows) {
    orderCounts.set(row.orderId, (orderCounts.get(row.orderId) ?? 0) + 1);
  }

  const items: ReconciliationItem[] = orders.map((row) => {
    const orderId = text(read(row, aliases.orderId));
    const orderAmount = money(read(row, aliases.amount));
    const paymentMode = text(read(row, aliases.paymentMode)) || "Unknown";
    const gatewayRow = gatewayRows.find((candidate) => candidate.orderId === orderId);
    const settlementRow = gatewayRow
      ? settlementRows.find(
          (candidate) =>
            candidate.orderId === orderId ||
            (candidate.reference && candidate.reference === gatewayRow.reference),
        )
      : undefined;

    if (!gatewayRow) {
      return {
        orderId,
        gatewayReference: "—",
        paymentMode,
        orderAmount,
        gatewayAmount: null,
        settledAmount: null,
        expectedNet: null,
        variance: orderAmount,
        status: "gateway_missing",
        severity: "high",
        summary: "Order exists internally but is missing from the gateway report.",
        evidence: [`Order file: ₹${orderAmount.toFixed(2)}`, "Gateway file: no matching row"],
      };
    }

    if ((orderCounts.get(orderId) ?? 0) > 1) {
      return {
        orderId,
        gatewayReference: gatewayRow.reference,
        paymentMode: gatewayRow.mode,
        orderAmount,
        gatewayAmount: gatewayRow.amount,
        settledAmount: settlementRow?.settledAmount ?? null,
        expectedNet: cents(gatewayRow.amount - gatewayRow.fee - gatewayRow.tax),
        variance: gatewayRow.amount,
        status: "duplicate",
        severity: "high",
        summary: "Multiple gateway rows use the same merchant order ID.",
        evidence: [
          `Gateway file: ${orderCounts.get(orderId)} rows`,
          `Reference: ${gatewayRow.reference}`,
        ],
      };
    }

    if (!isSuccessful(gatewayRow.status)) {
      return {
        orderId,
        gatewayReference: gatewayRow.reference,
        paymentMode: gatewayRow.mode,
        orderAmount,
        gatewayAmount: gatewayRow.amount,
        settledAmount: null,
        expectedNet: null,
        variance: 0,
        status: "pending",
        severity: "low",
        summary: `Gateway status is ${gatewayRow.status || "not final"}.`,
        evidence: [`Gateway status: ${gatewayRow.status || "blank"}`],
      };
    }

    const expectedNet = cents(gatewayRow.amount - gatewayRow.fee - gatewayRow.tax);

    if (!settlementRow) {
      return {
        orderId,
        gatewayReference: gatewayRow.reference,
        paymentMode: gatewayRow.mode,
        orderAmount,
        gatewayAmount: gatewayRow.amount,
        settledAmount: null,
        expectedNet,
        variance: expectedNet,
        status: "missing_settlement",
        severity: "high",
        summary: "Successful gateway payment has no bank settlement record.",
        evidence: [
          `Gateway captured: ₹${gatewayRow.amount.toFixed(2)}`,
          `Expected net: ₹${expectedNet.toFixed(2)}`,
        ],
      };
    }

    const variance = cents(settlementRow.settledAmount - expectedNet);
    if (Math.abs(variance) > 0.01) {
      return {
        orderId,
        gatewayReference: gatewayRow.reference,
        paymentMode: gatewayRow.mode,
        orderAmount,
        gatewayAmount: gatewayRow.amount,
        settledAmount: settlementRow.settledAmount,
        expectedNet,
        variance,
        status: "amount_mismatch",
        severity: Math.abs(variance) > 100 ? "high" : "medium",
        summary: "Bank settlement does not match gateway amount less fees and tax.",
        evidence: [
          `Expected net: ₹${expectedNet.toFixed(2)}`,
          `Bank settled: ₹${settlementRow.settledAmount.toFixed(2)}`,
          `UTR: ${settlementRow.utr || "not supplied"}`,
        ],
      };
    }

    return {
      orderId,
      gatewayReference: gatewayRow.reference,
      paymentMode: gatewayRow.mode,
      orderAmount,
      gatewayAmount: gatewayRow.amount,
      settledAmount: settlementRow.settledAmount,
      expectedNet,
      variance: 0,
      status: "matched",
      severity: "low",
      summary: "Order, gateway capture, fees, and bank settlement agree.",
      evidence: [
        `Expected net: ₹${expectedNet.toFixed(2)}`,
        `UTR: ${settlementRow.utr || "not supplied"}`,
      ],
    };
  });

  const processedValue = cents(
    items.reduce((sum, item) => sum + item.orderAmount, 0),
  );
  const matched = items.filter((item) => item.status === "matched");
  const matchedValue = cents(
    matched.reduce((sum, item) => sum + item.orderAmount, 0),
  );
  const exceptionCount = items.filter(
    (item) => !["matched", "pending"].includes(item.status),
  ).length;

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalOrders: items.length,
      processedValue,
      matchedValue,
      unmatchedValue: cents(processedValue - matchedValue),
      matchedCount: matched.length,
      exceptionCount,
      matchRate: items.length ? cents((matched.length / items.length) * 100) : 0,
    },
    items,
  };
}
