import { describe, expect, it } from "vitest";
import {
  REASON_CODE_POLICY,
  classifyInEngine,
  classifyWithContext,
  refineReasonCode,
  type ReasonCodeContext,
} from "./reason-codes";
import type {
  NormalizedGatewayRow,
  NormalizedSettlementRow,
} from "./strategies";
import type { ReasonCode } from "@/lib/types";

const ALL_CODES: ReasonCode[] = [
  "timing_not_due",
  "utr_missing",
  "utr_duplicate",
  "fee_mismatch",
  "gst_mismatch",
  "hold_unexplained",
  "payout_failed",
  "chargeback_pending_recovery",
  "refund_not_adjusted",
  "unmatched_other",
  "payout_sum_mismatch",
  "refund_offset_recognized",
];

function gateway(overrides: Partial<NormalizedGatewayRow> = {}): NormalizedGatewayRow {
  return {
    raw: {},
    rowNumber: 1,
    orderId: "ORD-1",
    reference: "GW-1",
    amount: 1000,
    status: "captured",
    mode: "UPI",
    fee: 10,
    tax: 1.8,
    transactionAt: "2026-06-26T10:00:00.000Z",
    ...overrides,
  };
}

function settlement(overrides: Partial<NormalizedSettlementRow> = {}): NormalizedSettlementRow {
  return {
    raw: {},
    rowNumber: 1,
    orderId: "ORD-1",
    reference: "GW-1",
    settledAmount: 988.2,
    utr: "UTR-1",
    status: "credited",
    settlementAt: "2026-06-26T18:00:00.000Z",
    statementReference: "",
    ...overrides,
  };
}

const emptyContext: ReasonCodeContext = {
  merchantSettlementBatches: [],
  duplicateUtrFlags: new Set(),
  paymentWorkflows: [],
};

describe("classifyInEngine", () => {
  it("returns timing_not_due when settlement is missing but cycle says not due", () => {
    expect(
      classifyInEngine({
        status: "missing_settlement",
        settlementStatus: "not_due",
        gateway: gateway(),
        settlement: null,
        variance: 0,
      }),
    ).toBe("timing_not_due");
  });

  it("returns fee_mismatch when variance aligns with the gateway fee", () => {
    expect(
      classifyInEngine({
        status: "amount_mismatch",
        settlementStatus: "due_today",
        gateway: gateway({ fee: 10 }),
        settlement: settlement({ settledAmount: 1000 }),
        variance: 10,
      }),
    ).toBe("fee_mismatch");
  });

  it("returns gst_mismatch when variance aligns with the gateway tax", () => {
    expect(
      classifyInEngine({
        status: "amount_mismatch",
        settlementStatus: "due_today",
        gateway: gateway({ tax: 18 }),
        settlement: settlement({ settledAmount: 988.2 }),
        variance: 18,
      }),
    ).toBe("gst_mismatch");
  });

  it("prefers fee_mismatch over gst_mismatch when both could plausibly fit", () => {
    expect(
      classifyInEngine({
        status: "amount_mismatch",
        settlementStatus: "due_today",
        gateway: gateway({ fee: 10, tax: 10 }),
        settlement: settlement(),
        variance: 10,
      }),
    ).toBe("fee_mismatch");
  });

  it("returns utr_missing when settlement row exists but utr is blank", () => {
    expect(
      classifyInEngine({
        status: "matched",
        settlementStatus: "settled",
        gateway: gateway(),
        settlement: settlement({ utr: "" }),
        variance: 0,
      }),
    ).toBe("utr_missing");
  });

  it("returns null when the item is cleanly matched and traceable", () => {
    expect(
      classifyInEngine({
        status: "matched",
        settlementStatus: "settled",
        gateway: gateway(),
        settlement: settlement(),
        variance: 0,
      }),
    ).toBeNull();
  });

  it("falls back to unmatched_other when no rule fits", () => {
    expect(
      classifyInEngine({
        status: "gateway_missing",
        settlementStatus: "timing_unavailable",
        gateway: null,
        settlement: null,
        variance: 1000,
      }),
    ).toBe("unmatched_other");
  });
});

describe("classifyWithContext", () => {
  it("returns utr_duplicate when one of the order's batches carries a UTR flagged duplicate", () => {
    expect(
      classifyWithContext("amount_mismatch", {
        ...emptyContext,
        merchantSettlementBatches: [{ utr: "UTR-DUP-77", status: "credited" }],
        duplicateUtrFlags: new Set(["UTR-DUP-77"]),
      }),
    ).toBe("utr_duplicate");
  });

  it("returns payout_failed before hold_unexplained when both apply", () => {
    expect(
      classifyWithContext("missing_settlement", {
        ...emptyContext,
        merchantSettlementBatches: [
          { utr: null, status: "failed" },
          { utr: null, status: "held" },
        ],
      }),
    ).toBe("payout_failed");
  });

  it("returns hold_unexplained when only held status applies", () => {
    expect(
      classifyWithContext("missing_settlement", {
        ...emptyContext,
        merchantSettlementBatches: [{ utr: null, status: "held" }],
      }),
    ).toBe("hold_unexplained");
  });

  it("returns chargeback_pending_recovery when a chargeback workflow is open", () => {
    expect(
      classifyWithContext("amount_mismatch", {
        ...emptyContext,
        paymentWorkflows: [{ type: "chargeback", status: "evidence_due" }],
      }),
    ).toBe("chargeback_pending_recovery");
  });

  it("returns refund_not_adjusted only on amount-mismatch or missing-settlement statuses", () => {
    const ctx = {
      ...emptyContext,
      paymentWorkflows: [
        { type: "refund" as const, status: "processing" },
      ],
    };
    expect(classifyWithContext("amount_mismatch", ctx)).toBe(
      "refund_not_adjusted",
    );
    expect(classifyWithContext("missing_settlement", ctx)).toBe(
      "refund_not_adjusted",
    );
    expect(classifyWithContext("matched", ctx)).toBeNull();
  });

  it("returns null when no cross-table signal applies", () => {
    expect(classifyWithContext("amount_mismatch", emptyContext)).toBeNull();
  });
});

describe("refineReasonCode", () => {
  it("prefers a cross-table code over the existing in-engine code", () => {
    expect(
      refineReasonCode(
        { reasonCode: "fee_mismatch", status: "amount_mismatch" },
        {
          ...emptyContext,
          paymentWorkflows: [{ type: "chargeback", status: "received" }],
        },
      ),
    ).toBe("chargeback_pending_recovery");
  });

  it("keeps the in-engine code when no cross-table code fires", () => {
    expect(
      refineReasonCode(
        { reasonCode: "fee_mismatch", status: "amount_mismatch" },
        emptyContext,
      ),
    ).toBe("fee_mismatch");
  });
});

describe("REASON_CODE_POLICY", () => {
  it("has a policy entry for every ReasonCode value", () => {
    for (const code of ALL_CODES) {
      expect(REASON_CODE_POLICY[code]).toBeDefined();
      expect(REASON_CODE_POLICY[code].slaHours).toBeGreaterThan(0);
      expect(REASON_CODE_POLICY[code].allowedActions.length).toBeGreaterThan(0);
    }
  });

  it("classifies payout_sum_mismatch as high-severity treasury escalation", () => {
    const policy = REASON_CODE_POLICY.payout_sum_mismatch;
    expect(policy.exposureTier).toBe("high");
    expect(policy.ownerDefault).toBe("treasury");
    expect(policy.autoCloseWhen).toBeNull();
    expect(policy.allowedActions).toEqual(
      expect.arrayContaining(["raise_to_provider", "raise_to_bank"]),
    );
  });

  it("classifies refund_offset_recognized as informational finance auto-close", () => {
    const policy = REASON_CODE_POLICY.refund_offset_recognized;
    expect(policy.exposureTier).toBe("informational");
    expect(policy.ownerDefault).toBe("finance");
    expect(policy.autoCloseWhen).toContain("effective_variance");
    expect(policy.evidenceRequired).toEqual(
      expect.arrayContaining(["payment_workflow", "refund_allocations"]),
    );
  });
});

describe("classifyInEngine never returns post-persist group/refund codes", () => {
  it("payout_sum_mismatch and refund_offset_recognized are only assigned by post-persist hooks", () => {
    const candidates = [
      classifyInEngine({
        status: "matched",
        settlementStatus: "settled",
        gateway: gateway(),
        settlement: settlement(),
        variance: 0,
      }),
      classifyInEngine({
        status: "amount_mismatch",
        settlementStatus: "settled",
        gateway: gateway({ fee: 50 }),
        settlement: settlement({ settledAmount: 940 }),
        variance: 50,
      }),
      classifyInEngine({
        status: "missing_settlement",
        settlementStatus: "overdue",
        gateway: gateway(),
        settlement: null,
        variance: 988.2,
      }),
      classifyInEngine({
        status: "gateway_missing",
        settlementStatus: "timing_unavailable",
        gateway: null,
        settlement: null,
        variance: 1000,
      }),
      classifyInEngine({
        status: "duplicate",
        settlementStatus: "settled",
        gateway: gateway(),
        settlement: settlement(),
        variance: 1000,
      }),
      classifyInEngine({
        status: "pending",
        settlementStatus: "timing_unavailable",
        gateway: gateway({ status: "pending" }),
        settlement: null,
        variance: 0,
      }),
    ];
    for (const code of candidates) {
      expect(code).not.toBe("payout_sum_mismatch");
      expect(code).not.toBe("refund_offset_recognized");
    }
  });
});
