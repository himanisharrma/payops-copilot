import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { db, transaction } from "@/lib/db";
import {
  getBalance,
  getBalanceWithFormula,
  listTransactions,
  postCaptureEntries,
  postRefundNettingEntries,
  postSettlementEntries,
  reverseTransaction,
} from "@/lib/modules/ledger/service";
import type {
  CaptureSource,
  RefundAllocationSource,
  SettlementSource,
} from "@/lib/modules/ledger/types";

const organizationsToDelete: string[] = [];

async function makeOrg(label: string) {
  const slug = `ledger-${label}-${randomUUID()}`;
  const org = await db.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1,$2) RETURNING id`,
    [`Ledger ${label}`, slug],
  );
  organizationsToDelete.push(org.rows[0].id);
  return org.rows[0].id;
}

async function makeMerchant(organizationId: string, label: string) {
  const merchant = await db.query<{ id: string }>(
    `INSERT INTO merchant_accounts (organization_id, merchant_reference, display_name)
     VALUES ($1,$2,$3) RETURNING id`,
    [organizationId, `merchant-${label}-${randomUUID().slice(0, 6)}`, `Merchant ${label}`],
  );
  return merchant.rows[0].id;
}

afterEach(async () => {
  while (organizationsToDelete.length) {
    await db.query("DELETE FROM organizations WHERE id = $1", [
      organizationsToDelete.pop(),
    ]);
  }
});

const ACTOR = { id: null, name: "Test Harness" };

function capture(
  merchantAccountId: string,
  amount: number,
  at: Date,
  suffix = "a",
): CaptureSource {
  return {
    sourceItemId: randomUUID(),
    merchantAccountId,
    provider: "razorpay_demo",
    grossAmount: amount,
    effectiveAt: at,
    externalRefs: {
      orderId: `ORD-${suffix}-${randomUUID().slice(0, 4)}`,
      gatewayReference: `PAY-${suffix}-${randomUUID().slice(0, 4)}`,
    },
  };
}

function balanceFor(
  rows: Array<{ accountRole: string; balance: number }>,
  role: string,
): number {
  return rows
    .filter((row) => row.accountRole === role)
    .reduce((sum, row) => sum + row.balance, 0);
}

describe("ledger service — multi-org isolation", () => {
  it("postCaptureEntries scopes balances to the posting org only", async () => {
    const orgA = await makeOrg("iso-a");
    const orgB = await makeOrg("iso-b");
    const merchantA = await makeMerchant(orgA, "iso-a");
    const merchantB = await makeMerchant(orgB, "iso-b");

    await transaction((client) =>
      postCaptureEntries(client, orgA, [capture(merchantA, 1000, new Date())], ACTOR),
    );
    await transaction((client) =>
      postCaptureEntries(client, orgB, [capture(merchantB, 250, new Date())], ACTOR),
    );

    const balancesA = await transaction((client) =>
      getBalance(client, orgA, merchantA, new Date()),
    );
    const balancesB = await transaction((client) =>
      getBalance(client, orgB, merchantB, new Date()),
    );
    expect(balanceFor(balancesA, "merchant_payable")).toBe(1000);
    expect(balanceFor(balancesB, "merchant_payable")).toBe(250);

    // Crossed org IDs return nothing for the other tenant's merchant.
    const crossed = await transaction((client) =>
      getBalance(client, orgB, merchantA, new Date()),
    );
    expect(balanceFor(crossed, "merchant_payable")).toBe(0);
  });
});

describe("ledger service — balance as of timestamp", () => {
  it("getBalance(asOf=T2) returns sum of transactions with effective_at <= T2", async () => {
    const org = await makeOrg("asof");
    const merchant = await makeMerchant(org, "asof");
    const t1 = new Date("2026-06-01T10:00:00Z");
    const t2 = new Date("2026-06-15T10:00:00Z");
    const t3 = new Date("2026-06-29T10:00:00Z");

    await transaction((client) =>
      postCaptureEntries(client, org, [
        capture(merchant, 100, t1, "t1"),
        capture(merchant, 200, t2, "t2"),
        capture(merchant, 400, t3, "t3"),
      ], ACTOR),
    );

    const atT2 = await transaction((client) => getBalance(client, org, merchant, t2));
    expect(balanceFor(atT2, "merchant_payable")).toBe(300);

    const atT3 = await transaction((client) => getBalance(client, org, merchant, t3));
    expect(balanceFor(atT3, "merchant_payable")).toBe(700);

    const beforeT1 = await transaction((client) =>
      getBalance(client, org, merchant, new Date("2026-05-01T00:00:00Z")),
    );
    expect(balanceFor(beforeT1, "merchant_payable")).toBe(0);
  });
});

describe("ledger service — full settlement lifecycle composes", () => {
  it("capture ₹1000 → fee ₹20 → gst ₹3.60 → bank credit ₹976.40 → payout ₹976.40 zeroes intermediate accounts", async () => {
    const org = await makeOrg("lifecycle");
    const merchant = await makeMerchant(org, "lifecycle");
    const at = new Date("2026-06-20T12:00:00Z");
    const batchId = randomUUID();

    await transaction((client) =>
      postCaptureEntries(
        client,
        org,
        [capture(merchant, 1000, at, "lifecycle")],
        ACTOR,
      ),
    );
    const settlement: SettlementSource = {
      batchId,
      merchantAccountId: merchant,
      provider: "razorpay_demo",
      utr: "UTR-LIFECYCLE",
      effectiveAt: at,
      netAmount: 976.4,
      deductions: [
        {
          sourceDeductionId: randomUUID(),
          type: "mdr",
          amount: 20,
          taxAmount: 0,
        },
        {
          sourceDeductionId: randomUUID(),
          type: "gst",
          amount: 3.6,
          taxAmount: 0,
        },
      ],
      bankCredits: [
        {
          sourceBankCreditId: randomUUID(),
          amount: 976.4,
          creditedAt: at,
        },
      ],
    };
    await transaction((client) =>
      postSettlementEntries(client, org, settlement, ACTOR),
    );

    const balances = await transaction((client) =>
      getBalance(client, org, merchant, at),
    );
    // After the full lifecycle, provider_receivable AND escrow_cash
    // should both be 0 (capture flowed through to merchant). fee_expense
    // and gst_liability hold the deductions. merchant_payable holds
    // what's still owed = capture - payout = 1000 - 976.40 = 23.60.
    expect(balanceFor(balances, "provider_receivable")).toBe(0);
    expect(balanceFor(balances, "escrow_cash")).toBe(0);
    expect(balanceFor(balances, "fee_expense")).toBe(20);
    expect(balanceFor(balances, "gst_liability")).toBe(3.6);
    expect(balanceFor(balances, "merchant_payable")).toBe(23.6);
  });
});

describe("ledger service — refund netting", () => {
  it("merchant_payable debit + provider_receivable credit reduces both", async () => {
    const org = await makeOrg("refund");
    const merchant = await makeMerchant(org, "refund");
    const at = new Date("2026-06-20T12:00:00Z");

    await transaction((client) =>
      postCaptureEntries(client, org, [capture(merchant, 1000, at)], ACTOR),
    );
    const allocation: RefundAllocationSource = {
      allocationId: randomUUID(),
      merchantAccountId: merchant,
      provider: "razorpay_demo",
      amount: 300,
      effectiveAt: at,
      externalRefs: {
        refundOrderId: "ORD-R",
        refundExternalReference: "REF-R",
      },
    };
    await transaction((client) =>
      postRefundNettingEntries(client, org, [allocation], ACTOR),
    );

    const balances = await transaction((client) =>
      getBalance(client, org, merchant, at),
    );
    // After capture ₹1000 + refund netting ₹300:
    //   merchant_payable: capture credited 1000, refund debited 300 → +700
    //   provider_receivable: capture debited 1000, refund credited 300 → +700
    // (PG still owes us 700 — the refund came out of our settlement pot.)
    // refund_payable stays 0 in v1 (reserved for v1.1 refund_initiation).
    expect(balanceFor(balances, "merchant_payable")).toBe(700);
    expect(balanceFor(balances, "provider_receivable")).toBe(700);
    expect(balanceFor(balances, "refund_payable")).toBe(0);
  });
});

describe("ledger service — idempotency", () => {
  it("re-running postCaptureEntries with the same source increments skipped, no duplicate entries, balance unchanged", async () => {
    const org = await makeOrg("idem");
    const merchant = await makeMerchant(org, "idem");
    const at = new Date("2026-06-20T12:00:00Z");
    const cap = capture(merchant, 500, at);

    const first = await transaction((client) =>
      postCaptureEntries(client, org, [cap], ACTOR),
    );
    const second = await transaction((client) =>
      postCaptureEntries(client, org, [cap], ACTOR),
    );
    expect(first).toMatchObject({
      transactionsPosted: 1,
      transactionsSkippedIdempotent: 0,
      entriesWritten: 2,
    });
    expect(second).toMatchObject({
      transactionsPosted: 0,
      transactionsSkippedIdempotent: 1,
      entriesWritten: 0,
    });
    const balances = await transaction((client) =>
      getBalance(client, org, merchant, at),
    );
    expect(balanceFor(balances, "merchant_payable")).toBe(500);
  });
});

describe("ledger service — reversal", () => {
  it("reverseTransaction posts the flipped pair; balance returns to zero", async () => {
    const org = await makeOrg("reverse");
    const merchant = await makeMerchant(org, "reverse");
    const at = new Date("2026-06-20T12:00:00Z");
    const cap = capture(merchant, 100, at);
    await transaction((client) =>
      postCaptureEntries(client, org, [cap], ACTOR),
    );

    const txRow = await db.query<{ id: string }>(
      `SELECT id FROM ledger_transactions WHERE organization_id=$1 AND source_id=$2`,
      [org, cap.sourceItemId],
    );
    const transactionId = txRow.rows[0].id;

    const result = await transaction((client) =>
      reverseTransaction(client, org, transactionId, "Voided in test", {
        id: null,
        name: "Admin Test",
      }),
    );
    expect(result.transactionsPosted).toBe(1);
    expect(result.entriesWritten).toBe(2);

    const balances = await transaction((client) =>
      getBalance(client, org, merchant, new Date()),
    );
    expect(balanceFor(balances, "merchant_payable")).toBe(0);
    expect(balanceFor(balances, "provider_receivable")).toBe(0);

    // Reverse again is idempotent — same idempotency key short-circuits.
    const second = await transaction((client) =>
      reverseTransaction(client, org, transactionId, "Voided in test", {
        id: null,
        name: "Admin Test",
      }),
    );
    expect(second.transactionsSkippedIdempotent).toBe(1);

    // Reversal of a reversal is rejected.
    const reversalRow = await db.query<{ id: string }>(
      `SELECT id FROM ledger_transactions WHERE organization_id=$1 AND reversal_of=$2`,
      [org, transactionId],
    );
    await expect(
      transaction((client) =>
        reverseTransaction(client, org, reversalRow.rows[0].id, "double-reverse", {
          id: "admin-test",
          name: "Admin Test",
        }),
      ),
    ).rejects.toThrow(/Cannot reverse a reversal entry/);
  });
});

describe("ledger service — append-only DB trigger", () => {
  it("blocks direct UPDATE on ledger_entries", async () => {
    const org = await makeOrg("trigger");
    const merchant = await makeMerchant(org, "trigger");
    const at = new Date("2026-06-20T12:00:00Z");
    await transaction((client) =>
      postCaptureEntries(
        client,
        org,
        [capture(merchant, 100, at)],
        ACTOR,
      ),
    );
    await expect(
      db.query(`UPDATE ledger_entries SET amount = 999 WHERE organization_id = $1`, [
        org,
      ]),
    ).rejects.toThrow(/ledger_entries is append-only/);
  });
});

describe("ledger service — getBalanceWithFormula", () => {
  it("composes opening + collections - mdr - gst - refund - payouts = closing across a window", async () => {
    const org = await makeOrg("formula");
    const merchant = await makeMerchant(org, "formula");
    const dayStartUtc = new Date("2026-06-20T18:30:00Z"); // start of IST day 2026-06-21
    const within = new Date("2026-06-21T05:00:00Z");
    const asOf = new Date("2026-06-21T18:29:59Z");
    const batchId = randomUUID();

    await transaction((client) =>
      postCaptureEntries(
        client,
        org,
        [capture(merchant, 1000, within, "f1")],
        ACTOR,
      ),
    );
    await transaction((client) =>
      postSettlementEntries(
        client,
        org,
        {
          batchId,
          merchantAccountId: merchant,
          provider: "razorpay_demo",
          utr: "UTR-F",
          effectiveAt: within,
          netAmount: 976.4,
          deductions: [
            { sourceDeductionId: randomUUID(), type: "mdr", amount: 20, taxAmount: 0 },
            { sourceDeductionId: randomUUID(), type: "gst", amount: 3.6, taxAmount: 0 },
          ],
          bankCredits: [
            { sourceBankCreditId: randomUUID(), amount: 976.4, creditedAt: within },
          ],
        },
        ACTOR,
      ),
    );

    const { formula } = await transaction((client) =>
      getBalanceWithFormula(client, org, merchant, asOf),
    );
    expect(formula.openingPayable).toBe(0);
    expect(formula.collections).toBe(1000);
    expect(formula.mdr).toBe(20);
    expect(formula.gst).toBe(3.6);
    expect(formula.payouts).toBe(976.4);
    expect(formula.closingPayable).toBe(23.6);
    // Sanity: this matches the lifecycle test's merchant_payable.
    expect(dayStartUtc.toISOString()).toBe("2026-06-20T18:30:00.000Z");
  });
});

describe("ledger service — listTransactions", () => {
  it("returns transactions for the merchant in window with embedded entries", async () => {
    const org = await makeOrg("list");
    const merchant = await makeMerchant(org, "list");
    const at = new Date("2026-06-20T12:00:00Z");
    await transaction((client) =>
      postCaptureEntries(
        client,
        org,
        [
          capture(merchant, 100, at, "l1"),
          capture(merchant, 200, at, "l2"),
        ],
        ACTOR,
      ),
    );
    const result = await transaction((client) =>
      listTransactions(client, org, {
        merchantAccountId: merchant,
        from: new Date("2026-06-01"),
        to: new Date("2026-07-01"),
        limit: 50,
      }),
    );
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].entries).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });
});
