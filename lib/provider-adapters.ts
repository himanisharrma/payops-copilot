import type {
  DataQualityIssue,
  ProviderDataQualityReport,
  ProviderFieldMapping,
  ProviderId,
  RawRecord,
} from "@/lib/types";
import { parseExplicitOffsetTimestamp } from "@/lib/settlement-policy";

export type ProviderAdapter = {
  id: ProviderId;
  name: string;
  description: string;
  settlementCycle: string;
  assumptions: string[];
  successStatuses: string[];
  aliases: Record<ProviderFieldMapping, string[]>;
};

export const providerAdapters = [
  {
    id: "generic",
    name: "Generic CSV",
    description: "Common payment-aggregator headers used by the demo dataset.",
    settlementCycle: "Uploaded settlement file is treated as the settlement truth.",
    assumptions: [
      "Gateway amount minus fee and GST should equal bank settlement.",
      "Merchant order ID is the primary match key.",
      "Gateway reference can be used as a fallback settlement match key.",
    ],
    successStatuses: ["captured", "success", "successful", "paid", "settled"],
    aliases: {
      orderId: ["order_id", "orderid", "merchant_order_id", "merchantorderid"],
      amount: [
        "amount",
        "order_amount",
        "txn_amount",
        "transaction_amount",
        "gross_amount",
      ],
      status: ["status", "payment_status", "txn_status", "transaction_status"],
      paymentMode: ["payment_mode", "paymentmethod", "payment_method", "mode"],
      gatewayReference: [
        "gateway_ref",
        "gateway_reference",
        "payment_id",
        "txn_id",
        "transaction_id",
      ],
      transactionAt: [
        "captured_at",
        "transaction_at",
        "payment_at",
        "created_at",
      ],
      settlementAt: [
        "settled_at",
        "settlement_at",
        "settlement_date",
        "processed_at",
      ],
      settledAmount: [
        "settled_amount",
        "net_amount",
        "settlement_amount",
        "net_settlement",
      ],
      fee: ["fee", "mdr", "gateway_fee", "processing_fee"],
      tax: ["tax", "gst", "fee_tax"],
      utr: ["utr", "bank_reference", "bank_ref", "settlement_utr"],
      statementReference: [
        "statement_reference",
        "settlement_batch_id",
        "payout_reference",
      ],
      transactionType: ["txn_type", "transaction_type", "record_type"],
    },
  },
  {
    id: "razorpay_demo",
    name: "Razorpay-style demo",
    description: "Synthetic adapter for Razorpay-like payment and settlement exports.",
    settlementCycle: "Settlement rows are expected after the provider settlement batch closes.",
    assumptions: [
      "Payment `captured` means funds can be expected in a later settlement.",
      "Razorpay payment ID or merchant order receipt may appear in settlement exports.",
      "Fee and tax are separate deductions in the gateway export.",
    ],
    successStatuses: ["captured", "settled"],
    aliases: {
      orderId: ["receipt", "order_id", "merchant_order_id"],
      amount: ["amount", "order_amount", "payment_amount"],
      status: ["status", "payment_status"],
      paymentMode: ["method", "payment_method", "payment_mode"],
      gatewayReference: ["id", "payment_id", "razorpay_payment_id"],
      transactionAt: ["captured_at", "created_at", "payment_at"],
      settlementAt: ["settled_at", "settlement_date", "processed_at"],
      settledAmount: ["settled_amount", "settlement_amount", "credit"],
      fee: ["fee", "razorpay_fee"],
      tax: ["tax", "gst"],
      utr: ["utr", "settlement_utr", "bank_reference"],
      statementReference: ["settlement_id", "settlement_batch_id"],
      transactionType: ["type", "transaction_type"],
    },
  },
  {
    id: "cashfree_demo",
    name: "Cashfree-style demo",
    description: "Synthetic adapter for Cashfree-like order, payment, and settlement files.",
    settlementCycle: "Successful payments are expected in the next synthetic settlement cycle.",
    assumptions: [
      "`SUCCESS` is treated as the final captured state.",
      "Cashfree order ID is treated as the merchant order key.",
      "Service charge and service tax are deducted before settlement.",
    ],
    successStatuses: ["success", "paid"],
    aliases: {
      orderId: ["cf_order_id", "order_id", "merchant_order_id"],
      amount: ["order_amount", "payment_amount", "amount"],
      status: ["order_status", "payment_status", "status"],
      paymentMode: ["payment_group", "payment_method", "mode"],
      gatewayReference: ["cf_payment_id", "payment_id", "reference_id"],
      transactionAt: ["payment_time", "payment_at", "created_at"],
      settlementAt: ["settlement_time", "settled_at", "processed_at"],
      settledAmount: ["settlement_amount", "net_settlement", "amount_settled"],
      fee: ["service_charge", "fee", "processing_fee"],
      tax: ["service_tax", "gst", "tax"],
      utr: ["utr", "bank_reference", "transfer_utr"],
      statementReference: ["settlement_id", "settlement_batch_id"],
      transactionType: ["transaction_type", "event_type"],
    },
  },
  {
    id: "payu_demo",
    name: "PayU-style demo",
    description: "Synthetic adapter for PayU-like transaction and settlement exports.",
    settlementCycle: "Captured payments reconcile against the provided settlement advice.",
    assumptions: [
      "`success` and `captured` are treated as final payment states.",
      "PayU transaction ID can be matched against settlement references.",
      "MDR and GST are expected as explicit deduction columns.",
    ],
    successStatuses: ["success", "captured"],
    aliases: {
      orderId: ["txnid", "order_id", "merchant_order_id"],
      amount: ["amount", "order_amount", "transaction_amount"],
      status: ["status", "unmappedstatus", "transaction_status"],
      paymentMode: ["mode", "payment_mode", "payment_source"],
      gatewayReference: ["mihpayid", "payu_id", "gateway_reference"],
      transactionAt: ["addedon", "transaction_at", "created_at"],
      settlementAt: ["settled_at", "settlement_date", "processed_at"],
      settledAmount: ["net_settlement", "settlement_amount", "net_amount"],
      fee: ["mdr", "fee", "gateway_fee"],
      tax: ["gst", "tax", "fee_tax"],
      utr: ["utr", "bank_ref_num", "bank_reference"],
      statementReference: ["settlement_id", "settlement_batch_id"],
      transactionType: ["transaction_type", "txn_type"],
    },
  },
] as const satisfies ProviderAdapter[];

export const providerIds = providerAdapters.map((provider) => provider.id);

export function getProviderAdapter(id?: string): ProviderAdapter {
  return (
    providerAdapters.find((provider) => provider.id === id) ??
    providerAdapters[0]
  );
}

export function profileProviderData(
  provider: ProviderAdapter,
  sources: {
    orders: RawRecord[];
    gateway: RawRecord[];
    settlements: RawRecord[];
  },
): ProviderDataQualityReport {
  const issues: DataQualityIssue[] = [];
  const fieldCoverage = {
    orders: mapFields(provider, sources.orders, ["orderId", "amount"]),
    gateway: mapFields(provider, sources.gateway, [
      "orderId",
      "amount",
      "status",
      "gatewayReference",
      "fee",
      "tax",
      "transactionAt",
    ]),
    settlements: mapFields(provider, sources.settlements, [
      "orderId",
      "gatewayReference",
      "settledAmount",
      "utr",
      "settlementAt",
    ]),
  };

  collectMissingFieldIssues(issues, fieldCoverage);
  collectInvalidAmountIssues(issues, provider, sources);
  collectDuplicateReferenceIssues(issues, provider, sources.gateway);
  collectUnknownStatusIssues(issues, provider, sources.gateway);
  collectTimestampIssues(issues, provider, sources);

  return {
    providerId: provider.id,
    providerName: provider.name,
    settlementCycle: provider.settlementCycle,
    assumptions: provider.assumptions,
    rowCounts: {
      orders: sources.orders.length,
      gateway: sources.gateway.length,
      settlements: sources.settlements.length,
    },
    fieldCoverage,
    issues,
  };
}

function collectTimestampIssues(
  issues: DataQualityIssue[],
  provider: ProviderAdapter,
  sources: {
    orders: RawRecord[];
    gateway: RawRecord[];
    settlements: RawRecord[];
  },
) {
  const successfulGateway = sources.gateway.filter((row) =>
    provider.successStatuses.includes(
      text(readProviderField(row, provider, "status")).toLowerCase(),
    ),
  );
  const transactionValues = successfulGateway.map((row) =>
    readProviderField(row, provider, "transactionAt"),
  );
  if (
    successfulGateway.length > 0 &&
    transactionValues.every((value) => !text(value))
  ) {
    const orderHasTimestamp = sources.orders.some((row) =>
      text(readProviderField(row, provider, "transactionAt")),
    );
    if (!orderHasTimestamp) {
      issues.push({
        severity: "warning",
        source: "gateway",
        code: "missing_transaction_timestamp",
        message:
          "No explicit-offset gateway or order timestamp is available for settlement timing.",
      });
    }
  }
  const invalidTransactions = [
    ...successfulGateway.map((row) =>
      readProviderField(row, provider, "transactionAt"),
    ),
    ...sources.orders.map((row) =>
      readProviderField(row, provider, "transactionAt"),
    ),
  ].filter(
    (value) =>
      text(value) &&
      !parseExplicitOffsetTimestamp(text(value)),
  ).length;
  if (invalidTransactions) {
    issues.push({
      severity: "warning",
      source: "gateway",
      code: "invalid_transaction_timestamp",
      message: `${invalidTransactions} transaction timestamp(s) are not explicit-offset ISO values.`,
    });
  }
  const settlementValues = sources.settlements.map((row) =>
    readProviderField(row, provider, "settlementAt"),
  );
  if (
    sources.settlements.length > 0 &&
    settlementValues.every((value) => !text(value))
  ) {
    issues.push({
      severity: "info",
      source: "settlements",
      code: "missing_settlement_timestamp",
      message:
        "Settlement rows have no timestamp, so they are excluded from on-time metrics.",
    });
  }
  const invalidSettlements = settlementValues.filter(
    (value) =>
      text(value) &&
      !parseExplicitOffsetTimestamp(text(value)),
  ).length;
  if (invalidSettlements) {
    issues.push({
      severity: "warning",
      source: "settlements",
      code: "invalid_settlement_timestamp",
      message: `${invalidSettlements} settlement timestamp(s) are not explicit-offset ISO values.`,
    });
  }
}

export function normalizedKey(key: string) {
  return key.toLowerCase().trim().replace(/[\s-]+/g, "_");
}

export function readProviderField(
  record: RawRecord,
  provider: ProviderAdapter,
  field: ProviderFieldMapping,
) {
  const normalized = Object.fromEntries(
    Object.entries(record).map(([key, value]) => [normalizedKey(key), value]),
  );
  const match = provider.aliases[field].find(
    (key) => normalized[normalizedKey(key)] !== undefined,
  );
  return match ? normalized[normalizedKey(match)] : undefined;
}

function mapFields(
  provider: ProviderAdapter,
  rows: RawRecord[],
  required: ProviderFieldMapping[],
) {
  const headers = new Set(
    rows.flatMap((row) => Object.keys(row).map((key) => normalizedKey(key))),
  );
  return required.map((field) => {
    const matchedHeader =
      provider.aliases[field].find((alias) => headers.has(normalizedKey(alias))) ??
      null;
    return { field, matchedHeader };
  });
}

function collectMissingFieldIssues(
  issues: DataQualityIssue[],
  coverage: ProviderDataQualityReport["fieldCoverage"],
) {
  for (const [source, fields] of Object.entries(coverage)) {
    for (const field of fields) {
      if (!field.matchedHeader) {
        issues.push({
          severity: "warning",
          source: source as DataQualityIssue["source"],
          code: "missing_field_mapping",
          message: `${source} file has no mapped ${field.field} column for the selected provider.`,
        });
      }
    }
  }
}

function collectInvalidAmountIssues(
  issues: DataQualityIssue[],
  provider: ProviderAdapter,
  sources: {
    orders: RawRecord[];
    gateway: RawRecord[];
    settlements: RawRecord[];
  },
) {
  const checks: Array<{
    source: DataQualityIssue["source"];
    rows: RawRecord[];
    field: ProviderFieldMapping;
  }> = [
    { source: "orders", rows: sources.orders, field: "amount" },
    { source: "gateway", rows: sources.gateway, field: "amount" },
    { source: "settlements", rows: sources.settlements, field: "settledAmount" },
  ];

  for (const check of checks) {
    const invalidRows = check.rows.filter((row) => {
      const value = readProviderField(row, provider, check.field);
      return value !== undefined && !Number.isFinite(parseMoney(value));
    }).length;
    if (invalidRows) {
      issues.push({
        severity: "error",
        source: check.source,
        code: "invalid_amount",
        message: `${invalidRows} ${check.source} row(s) contain an amount that cannot be parsed.`,
      });
    }
  }
}

function collectDuplicateReferenceIssues(
  issues: DataQualityIssue[],
  provider: ProviderAdapter,
  gateway: RawRecord[],
) {
  const seen = new Map<string, number>();
  for (const row of gateway) {
    const orderId = text(readProviderField(row, provider, "orderId"));
    if (!orderId) continue;
    seen.set(orderId, (seen.get(orderId) ?? 0) + 1);
  }
  const duplicateCount = [...seen.values()].filter((count) => count > 1).length;
  if (duplicateCount) {
    issues.push({
      severity: "warning",
      source: "gateway",
      code: "duplicate_order_reference",
      message: `${duplicateCount} gateway order reference(s) appear more than once.`,
    });
  }
}

function collectUnknownStatusIssues(
  issues: DataQualityIssue[],
  provider: ProviderAdapter,
  gateway: RawRecord[],
) {
  const statuses = new Set(
    gateway
      .map((row) => text(readProviderField(row, provider, "status")).toLowerCase())
      .filter(Boolean),
  );
  const unknownStatuses = [...statuses].filter(
    (status) => !provider.successStatuses.includes(status) && status !== "pending",
  );
  if (unknownStatuses.length) {
    issues.push({
      severity: "info",
      source: "gateway",
      code: "unknown_status",
      message: `Gateway statuses treated as non-final: ${unknownStatuses.join(", ")}.`,
    });
  }
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function parseMoney(value: unknown) {
  return Number(String(value ?? "").replace(/[₹,\s]/g, ""));
}
