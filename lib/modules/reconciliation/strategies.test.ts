import { describe, expect, it } from "vitest";
import {
  findByAmountDateWindow,
  findByExactOrderId,
  findByGatewayReference,
  selectMatchOutcome,
  type NormalizedGatewayRow,
  type NormalizedSettlementRow,
} from "./strategies";

function gateway(overrides: Partial<NormalizedGatewayRow> = {}): NormalizedGatewayRow {
  return {
    raw: {},
    rowNumber: 1,
    orderId: "ORD-1",
    reference: "GW-1",
    amount: 1000,
    status: "captured",
    mode: "UPI",
    fee: 0,
    tax: 0,
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
    settledAmount: 1000,
    utr: "UTR-1",
    status: "credited",
    settlementAt: "2026-06-26T18:00:00.000Z",
    statementReference: "",
    ...overrides,
  };
}

describe("matching strategies", () => {
  it("findByExactOrderId matches when settlement carries the same order_id", () => {
    const s = settlement({ orderId: "ORD-7" });
    expect(findByExactOrderId("ORD-7", [s])).toBe(s);
    expect(findByExactOrderId("ORD-MISSING", [s])).toBeNull();
    expect(findByExactOrderId("", [s])).toBeNull();
  });

  it("findByGatewayReference matches when settlement carries the same gateway reference", () => {
    const s = settlement({ orderId: "", reference: "GW-42" });
    expect(findByGatewayReference(gateway({ reference: "GW-42" }), [s])).toBe(s);
    expect(findByGatewayReference(gateway({ reference: "GW-OTHER" }), [s])).toBeNull();
    expect(findByGatewayReference(gateway({ reference: "" }), [s])).toBeNull();
  });

  it("findByAmountDateWindow matches when amount and date are within tolerance", () => {
    const s = settlement({
      orderId: "",
      reference: "",
      settledAmount: 1000.5,
      settlementAt: "2026-06-26T20:00:00.000Z",
    });
    expect(findByAmountDateWindow(gateway(), [s])).toBe(s);

    const sOffDate = settlement({
      orderId: "",
      reference: "",
      settledAmount: 1000,
      settlementAt: "2026-07-01T20:00:00.000Z",
    });
    expect(findByAmountDateWindow(gateway(), [sOffDate])).toBeNull();

    const sOffAmount = settlement({
      orderId: "",
      reference: "",
      settledAmount: 950,
      settlementAt: "2026-06-26T20:00:00.000Z",
    });
    expect(findByAmountDateWindow(gateway(), [sOffAmount])).toBeNull();
  });
});

describe("selectMatchOutcome", () => {
  it("returns unmatched/none when no gateway row exists", () => {
    const outcome = selectMatchOutcome("ORD-1", undefined, [settlement()]);
    expect(outcome.strategy).toBe("unmatched");
    expect(outcome.confidence).toBe("none");
    expect(outcome.gateway).toBeNull();
    expect(outcome.settlement).toBeNull();
  });

  it("returns exact_order_id/exact when settlement matches by order_id", () => {
    const outcome = selectMatchOutcome("ORD-1", gateway(), [settlement()]);
    expect(outcome.strategy).toBe("exact_order_id");
    expect(outcome.confidence).toBe("exact");
    expect(outcome.settlement).not.toBeNull();
  });

  it("falls back to gateway_reference_fallback/high when settlement only matches by reference", () => {
    const outcome = selectMatchOutcome("ORD-1", gateway({ reference: "GW-9" }), [
      settlement({ orderId: "", reference: "GW-9" }),
    ]);
    expect(outcome.strategy).toBe("gateway_reference_fallback");
    expect(outcome.confidence).toBe("high");
  });

  it("falls back to amount_date_window/medium when only amount and date align", () => {
    const outcome = selectMatchOutcome("ORD-1", gateway({ reference: "GW-X" }), [
      settlement({
        orderId: "",
        reference: "GW-Y",
        settledAmount: 1000,
        settlementAt: "2026-06-26T20:00:00.000Z",
      }),
    ]);
    expect(outcome.strategy).toBe("amount_date_window");
    expect(outcome.confidence).toBe("medium");
  });

  it("returns unmatched/none with the gateway preserved when no settlement strategy fires", () => {
    const outcome = selectMatchOutcome("ORD-1", gateway(), []);
    expect(outcome.strategy).toBe("unmatched");
    expect(outcome.confidence).toBe("none");
    expect(outcome.gateway).not.toBeNull();
    expect(outcome.settlement).toBeNull();
  });

  it("prefers exact_order_id over fallback when both would match", () => {
    const settlementWithBoth = settlement({ orderId: "ORD-1", reference: "GW-1" });
    const settlementByReferenceOnly = settlement({
      orderId: "",
      reference: "GW-1",
    });
    const outcome = selectMatchOutcome("ORD-1", gateway(), [
      settlementByReferenceOnly,
      settlementWithBoth,
    ]);
    expect(outcome.strategy).toBe("exact_order_id");
    expect(outcome.settlement).toBe(settlementWithBoth);
  });
});
