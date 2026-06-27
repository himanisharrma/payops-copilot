import { createHash } from "node:crypto";
import type {
  EvidenceSourceType,
  ProviderFieldMapping,
  RawRecord,
  ReconciliationItem,
  ReconciliationRequest,
  ReconciliationResult,
  SettlementTimestampSource,
  SourceEvidence,
} from "./types";
import {
  getProviderAdapter,
  normalizedKey,
  profileProviderData,
  readProviderField,
} from "./provider-adapters";
import {
  calculateExpectedSettlement,
  classifySettlement,
  isCaseActionable,
  parseExplicitOffsetTimestamp,
} from "./settlement-policy";
import { selectMatchOutcome } from "./modules/reconciliation/strategies";

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

function retainedSourceValues(
  row: RawRecord,
  aliases: Record<ProviderFieldMapping, string[]>,
  fields: ProviderFieldMapping[],
) {
  const entries = Object.entries(row);
  const retained = new Map<string, string | number | null>();
  for (const field of fields) {
    const matched = entries.find(([header]) =>
      aliases[field].some(
        (alias) => normalizedKey(alias) === normalizedKey(header),
      ),
    );
    if (matched && matched[1] !== undefined) {
      retained.set(matched[0], matched[1] ?? null);
    }
  }
  return Object.fromEntries(
    [...retained.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

function stableJson(value: Record<string, string | number | null>) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
}

function evidenceSnapshot(input: {
  sourceType: EvidenceSourceType;
  rowNumber: number;
  sourceValues: Record<string, string | number | null>;
  normalizedValues: Record<string, string | number | null>;
}): SourceEvidence {
  const fingerprint = [
    input.sourceType,
    String(input.rowNumber),
    stableJson(input.normalizedValues),
    stableJson(input.sourceValues),
  ].join("\n");

  return {
    sourceType: input.sourceType,
    rowNumber: input.rowNumber,
    normalizedValues: input.normalizedValues,
    sourceValues: input.sourceValues,
    integrityHash: createHash("sha256").update(fingerprint).digest("hex"),
  };
}

function isSuccessful(status: string, successStatuses: string[]) {
  return successStatuses.includes(status.toLowerCase());
}

export function reconcilePayments(
  request: ReconciliationRequest,
  now: string | Date = new Date(),
): ReconciliationResult {
  const { orders, gateway, settlements } = request;
  const provider = getProviderAdapter(request.providerId);
  const providerReport = profileProviderData(provider, {
    orders,
    gateway,
    settlements,
  });
  const gatewayRows = gateway.map((row, index) => ({
    raw: row,
    rowNumber: index + 1,
    orderId: text(readProviderField(row, provider, "orderId")),
    reference: text(readProviderField(row, provider, "gatewayReference")),
    amount: money(readProviderField(row, provider, "amount")),
    status: text(readProviderField(row, provider, "status")),
    mode: text(readProviderField(row, provider, "paymentMode")) || "Unknown",
    fee: money(readProviderField(row, provider, "fee")),
    tax: money(readProviderField(row, provider, "tax")),
    transactionAt: text(readProviderField(row, provider, "transactionAt")),
  }));

  const settlementRows = settlements.map((row, index) => ({
    raw: row,
    rowNumber: index + 1,
    orderId: text(readProviderField(row, provider, "orderId")),
    reference: text(readProviderField(row, provider, "gatewayReference")),
    settledAmount: money(readProviderField(row, provider, "settledAmount")),
    utr: text(readProviderField(row, provider, "utr")),
    status: text(readProviderField(row, provider, "status")),
    settlementAt: text(readProviderField(row, provider, "settlementAt")),
  }));

  const orderCounts = new Map<string, number>();
  for (const row of gatewayRows) {
    orderCounts.set(row.orderId, (orderCounts.get(row.orderId) ?? 0) + 1);
  }

  const items: ReconciliationItem[] = orders.map((row, orderIndex) => {
    const orderId = text(readProviderField(row, provider, "orderId"));
    const orderAmount = money(readProviderField(row, provider, "amount"));
    const paymentMode =
      text(readProviderField(row, provider, "paymentMode")) || "Unknown";
    const orderTransactionAt = text(
      readProviderField(row, provider, "transactionAt"),
    );
    const matchingGatewayRows = gatewayRows.filter(
      (candidate) => candidate.orderId === orderId,
    );
    const gatewayRow = matchingGatewayRows[0];
    const matchOutcome = selectMatchOutcome(orderId, gatewayRow, settlementRows);
    const settlementRow = matchOutcome.settlement ?? undefined;
    const matchFields = {
      matchStrategy: matchOutcome.strategy,
      matchConfidence: matchOutcome.confidence,
    };
    const orderEvidence = evidenceSnapshot({
      sourceType: "orders",
      rowNumber: orderIndex + 1,
      sourceValues: retainedSourceValues(row, provider.aliases, [
        "orderId",
        "amount",
        "paymentMode",
      ]),
      normalizedValues: {
        orderId,
        amount: orderAmount,
        paymentMode,
      },
    });
    const gatewayEvidence = matchingGatewayRows.map((candidate) =>
      evidenceSnapshot({
        sourceType: "gateway",
        rowNumber: candidate.rowNumber,
        sourceValues: retainedSourceValues(
          candidate.raw,
          provider.aliases,
          [
            "orderId",
            "gatewayReference",
            "amount",
            "status",
            "paymentMode",
            "fee",
            "tax",
            "transactionAt",
          ],
        ),
        normalizedValues: {
          orderId: candidate.orderId,
          gatewayReference: candidate.reference,
          amount: candidate.amount,
          status: candidate.status,
          paymentMode: candidate.mode,
          fee: candidate.fee,
          tax: candidate.tax,
          transactionAt: candidate.transactionAt,
        },
      }),
    );
    const settlementEvidence = settlementRow
      ? [
          evidenceSnapshot({
            sourceType: "settlements",
            rowNumber: settlementRow.rowNumber,
            sourceValues: retainedSourceValues(
              settlementRow.raw,
              provider.aliases,
              [
                "orderId",
                "gatewayReference",
                "settledAmount",
                "utr",
                "status",
                "settlementAt",
              ],
            ),
            normalizedValues: {
              orderId: settlementRow.orderId,
              gatewayReference: settlementRow.reference,
              settledAmount: settlementRow.settledAmount,
              utr: settlementRow.utr,
              status: settlementRow.status,
              settlementAt: settlementRow.settlementAt,
            },
          }),
        ]
      : [];
    const relatedSourceEvidence = [
      orderEvidence,
      ...gatewayEvidence,
      ...settlementEvidence,
    ];
    const successfulGateway = Boolean(
      gatewayRow &&
        isSuccessful(gatewayRow.status, provider.successStatuses),
    );
    const gatewayTimestamp = gatewayRow?.transactionAt
      ? parseExplicitOffsetTimestamp(gatewayRow.transactionAt)
      : null;
    const orderTimestamp = orderTransactionAt
      ? parseExplicitOffsetTimestamp(orderTransactionAt)
      : null;
    const transactionTimestampSource: SettlementTimestampSource | null =
      gatewayTimestamp
      ? "gateway_capture"
      : orderTimestamp
        ? "order_created"
        : null;
    const transactionAt = gatewayTimestamp ?? orderTimestamp;
    const timing = successfulGateway && transactionTimestampSource
      ? calculateExpectedSettlement({
          providerId: provider.id,
          paymentMode: gatewayRow?.mode ?? paymentMode,
          transactionAt: transactionAt!.toISOString(),
          transactionTimestampSource,
        })
      : {
          expectedSettlementAt: null,
          policy: null,
          evidence: null,
        };
    const settlementRecordedAt = settlementRow?.settlementAt
      ? parseExplicitOffsetTimestamp(settlementRow.settlementAt)
      : null;
    const settlementStatus = classifySettlement({
      hasSettlementRecord: Boolean(settlementRow),
      expectedSettlementAt: timing.expectedSettlementAt,
      now,
    });
    const timingFields = {
      settlementStatus,
      transactionAt: transactionAt?.toISOString() ?? null,
      transactionTimestampSource,
      settlementRecordedAt: settlementRecordedAt?.toISOString() ?? null,
      settlementCycle: timing.policy?.cycle ?? null,
      expectedSettlementAt:
        timing.expectedSettlementAt?.toISOString() ?? null,
      settlementPolicyVersion: timing.policy?.policyVersion ?? null,
      settlementCalendarVersion: timing.policy?.calendarVersion ?? null,
      settlementTimingEvidence: timing.evidence,
    };

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
        ...timingFields,
        ...matchFields,
        severity: "high",
        summary: "Order exists internally but is missing from the gateway report.",
        evidence: [`Order file: ₹${orderAmount.toFixed(2)}`, "Gateway file: no matching row"],
        sourceEvidence: relatedSourceEvidence,
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
        ...timingFields,
        ...matchFields,
        severity: "high",
        summary: "Multiple gateway rows use the same merchant order ID.",
        evidence: [
          `Gateway file: ${orderCounts.get(orderId)} rows`,
          `Reference: ${gatewayRow.reference}`,
        ],
        sourceEvidence: relatedSourceEvidence,
      };
    }

    if (!isSuccessful(gatewayRow.status, provider.successStatuses)) {
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
        ...timingFields,
        ...matchFields,
        severity: "low",
        summary: `Gateway status is ${gatewayRow.status || "not final"}.`,
        evidence: [`Gateway status: ${gatewayRow.status || "blank"}`],
        sourceEvidence: relatedSourceEvidence,
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
        ...timingFields,
        ...matchFields,
        severity: settlementStatus === "overdue" ? "high" : "low",
        summary:
          settlementStatus === "overdue"
            ? "Expected settlement is overdue and no bank settlement record was supplied."
            : settlementStatus === "due_today"
              ? "Settlement is due today and remains within the fictional provider cycle."
              : settlementStatus === "not_due"
                ? "Settlement is still within the fictional provider cycle."
                : "Successful gateway payment has no settlement timing evidence.",
        evidence: [
          `Gateway captured: ₹${gatewayRow.amount.toFixed(2)}`,
          `Expected net: ₹${expectedNet.toFixed(2)}`,
        ],
        sourceEvidence: relatedSourceEvidence,
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
        ...timingFields,
        ...matchFields,
        severity: Math.abs(variance) > 100 ? "high" : "medium",
        summary: "Bank settlement does not match gateway amount less fees and tax.",
        evidence: [
          `Expected net: ₹${expectedNet.toFixed(2)}`,
          `Bank settled: ₹${settlementRow.settledAmount.toFixed(2)}`,
          `UTR: ${settlementRow.utr || "not supplied"}`,
        ],
        sourceEvidence: relatedSourceEvidence,
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
      ...timingFields,
      ...matchFields,
      severity: "low",
      summary: "Order, gateway capture, fees, and bank settlement agree.",
      evidence: [
        `Expected net: ₹${expectedNet.toFixed(2)}`,
        `UTR: ${settlementRow.utr || "not supplied"}`,
      ],
      sourceEvidence: relatedSourceEvidence,
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
    (item) =>
      isCaseActionable({
        reconciliationStatus: item.status,
        settlementStatus: item.settlementStatus,
      }),
  ).length;

  return {
    generatedAt: new Date().toISOString(),
    providerReport,
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
