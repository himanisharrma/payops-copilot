import { describe, expect, it } from "vitest";
import {
  classifyImportedRow,
  parseSettlementImportCsv,
} from "@/lib/modules/settlement-imports/service";

const now = new Date("2026-06-25T12:00:00.000Z");

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    row_number: 1,
    statement_reference: "STMT-001",
    merchant_reference: "merchant-demo",
    order_id: "ORD-001",
    gateway_reference: "PAY-001",
    payment_mode: "UPI",
    gross_amount: "1000.00",
    deduction_amount: "20.00",
    net_amount: "980.00",
    deduction_type: "mdr",
    utr: "UTR-001",
    bank_reference: "BANK-001",
    settlement_status: "credited",
    expected_settlement_at: new Date("2026-06-24T12:00:00.000Z"),
    actual_settlement_at: new Date("2026-06-24T13:00:00.000Z"),
    ...overrides,
  } as Parameters<typeof classifyImportedRow>[0]["row"];
}

const ledgerMatch = {
  settlement_batch_id: "batch-1",
  settlement_line_id: "line-1",
  bank_credit_id: "credit-1",
  operations_case_id: null,
  batch_net_amount: "980.00",
  batch_deduction_amount: "20.00",
  batch_utr: "UTR-001",
  bank_credit_amount: "980.00",
  bank_match_status: "matched",
};

describe("settlement import CSV parser", () => {
  it("normalizes provider-style headers and fingerprints rows", () => {
    const rows = parseSettlementImportCsv(`Settlement ID,Merchant ID,Merchant Order ID,Payment ID,Method,Collected Amount,Fees,Fee Type,Settlement UTR,Status
STMT-001,merchant-demo,ORD-001,PAY-001,upi,1000,20,mdr,UTR-001,credited`);

    expect(rows[0]).toMatchObject({
      statementReference: "STMT-001",
      merchantReference: "merchant-demo",
      orderId: "ORD-001",
      gatewayReference: "PAY-001",
      paymentMode: "upi",
      grossAmount: 1000,
      deductionAmount: 20,
      netAmount: 980,
      deductionType: "mdr",
      utr: "UTR-001",
      settlementStatus: "credited",
    });
    expect(rows[0].rowFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects empty rows and impossible deduction math", () => {
    expect(() =>
      parseSettlementImportCsv(
        "statement_reference,merchant_reference,order_id,gateway_reference,gross_amount\n,,,,",
      ),
    ).toThrow("no rows");
    expect(() =>
      parseSettlementImportCsv(`statement_reference,merchant_reference,order_id,gateway_reference,gross_amount,deduction_amount
STMT-001,merchant-demo,ORD-001,PAY-001,10,11`),
    ).toThrow("deductions exceed gross");
  });
});

describe("settlement import deterministic classifier", () => {
  it("classifies matched rows without an exception", () => {
    expect(
      classifyImportedRow({
        row: row(),
        match: ledgerMatch,
        duplicateUtrCount: 1,
        now,
      }),
    ).toMatchObject({
      exceptionType: null,
      amountVariance: 0,
      deductionVariance: 0,
      exposureAmount: 0,
    });
  });

  it("prioritizes forward deductions before generic deduction mismatches", () => {
    expect(
      classifyImportedRow({
        row: row({ deduction_amount: "45.00", net_amount: "955.00", deduction_type: "refund" }),
        match: ledgerMatch,
        duplicateUtrCount: 1,
        now,
      }).exceptionType,
    ).toBe("forward_deduction_mismatch");
  });

  it("classifies missing and duplicate UTRs deterministically", () => {
    expect(
      classifyImportedRow({
        row: row({ utr: null }),
        match: ledgerMatch,
        duplicateUtrCount: 0,
        now,
      }).exceptionType,
    ).toBe("missing_utr");
    expect(
      classifyImportedRow({
        row: row(),
        match: ledgerMatch,
        duplicateUtrCount: 2,
        now,
      }).exceptionType,
    ).toBe("duplicate_utr");
  });

  it("separates retry exhausted, delayed credit, and amount mismatch", () => {
    expect(
      classifyImportedRow({
        row: row({ settlement_status: "sent" }),
        match: { ...ledgerMatch, bank_credit_id: null },
        duplicateUtrCount: 1,
        now,
      }).exceptionType,
    ).toBe("retry_exhausted");
    expect(
      classifyImportedRow({
        row: row({ expected_settlement_at: new Date("2026-06-22T12:00:00Z") }),
        match: { ...ledgerMatch, bank_credit_id: null },
        duplicateUtrCount: 1,
        now,
      }).exceptionType,
    ).toBe("delayed_credit");
    expect(
      classifyImportedRow({
        row: row({ net_amount: "990.00" }),
        match: ledgerMatch,
        duplicateUtrCount: 1,
        now,
      }).exceptionType,
    ).toBe("amount_mismatch");
  });
});
