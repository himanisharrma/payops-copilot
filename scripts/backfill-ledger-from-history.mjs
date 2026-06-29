// Slice 6c — one-shot backfill of pre-Slice-6b reconciliation history into
// the ledger. Slice 6b's bridges fire only on NEW runs / refreshes; rows
// that landed before #28 merged have no ledger transactions, so per-PG
// receivable cards show opening = 0 for historical batches.
//
// This script replays:
//   1. matched + amount_mismatch reconciliation_items → capture entries
//   2. merchant_settlement_batches' deductions + bank_credits + payout
//      → fee/gst/bank_credit/payout entries
//   3. applied reconciliation_refund_allocations → refund_netting entries
//
// Idempotent: every event uses the same deterministic key the bridges use
// (capture:<id>, fee:<id>:<amount>, gst:<id>:<amount>,
// bank_credit:<id>:<amount>, payout:<batchId>:<amount>,
// refund_netting:<id>). ON CONFLICT (org, idempotency_key) DO NOTHING
// means re-runs are no-ops — the second run reports all "skipped".
//
// Pattern matches scripts/backfill-reason-codes.mjs: raw pg.Client + SQL,
// no TypeScript service import (no tsx in repo). The SQL logic mirrors
// lib/modules/ledger/posting-recipes.ts — if recipes change, update both.

import pg from "pg";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://payops:payops_local@127.0.0.1:5438/payops";

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

const totals = {
  captures: { posted: 0, skipped: 0 },
  fees: { posted: 0, skipped: 0 },
  gsts: { posted: 0, skipped: 0 },
  bankCredits: { posted: 0, skipped: 0 },
  payouts: { posted: 0, skipped: 0 },
  refundNettings: { posted: 0, skipped: 0 },
};

try {
  const orgs = await client.query(
    "SELECT id, name FROM organizations ORDER BY name",
  );
  for (const org of orgs.rows) {
    const counts = await backfillOrg(org.id);
    for (const key of Object.keys(totals)) {
      totals[key].posted += counts[key].posted;
      totals[key].skipped += counts[key].skipped;
    }
    console.log(
      `[backfill] org=${org.name}`
      + ` captures(${counts.captures.posted}/${counts.captures.skipped})`
      + ` fees(${counts.fees.posted}/${counts.fees.skipped})`
      + ` gsts(${counts.gsts.posted}/${counts.gsts.skipped})`
      + ` bankCredits(${counts.bankCredits.posted}/${counts.bankCredits.skipped})`
      + ` payouts(${counts.payouts.posted}/${counts.payouts.skipped})`
      + ` refunds(${counts.refundNettings.posted}/${counts.refundNettings.skipped})`,
    );
  }
  console.log("---");
  const grandTotal = await client.query(
    "SELECT COUNT(*)::int AS n FROM ledger_transactions",
  );
  console.log(
    `[backfill] totals: posted=${sum(totals, "posted")}`
    + ` skipped=${sum(totals, "skipped")}`,
  );
  console.log(`[backfill] ledger_transactions in DB: ${grandTotal.rows[0].n}`);
} finally {
  await client.end();
}

function sum(obj, field) {
  return Object.values(obj).reduce((a, x) => a + x[field], 0);
}

async function backfillOrg(organizationId) {
  const counts = {
    captures: { posted: 0, skipped: 0 },
    fees: { posted: 0, skipped: 0 },
    gsts: { posted: 0, skipped: 0 },
    bankCredits: { posted: 0, skipped: 0 },
    payouts: { posted: 0, skipped: 0 },
    refundNettings: { posted: 0, skipped: 0 },
  };

  await client.query("BEGIN");
  try {
    // Resolve the default merchant account for the org. Slice 6b uses
    // `ensureDefaultMerchantAccount`, which is the single synthetic
    // merchant per org. Create one if missing — this also lazily seeds
    // the chart of accounts because migration 032's DO block doesn't
    // run for merchants created post-migration.
    const merchant = await client.query(
      `INSERT INTO merchant_accounts (organization_id, merchant_reference, display_name)
       VALUES ($1, 'synthetic-demo-merchant', 'Synthetic Demo Merchant')
       ON CONFLICT (organization_id, merchant_reference)
       DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [organizationId],
    );
    const merchantAccountId = merchant.rows[0].id;
    await ensureLedgerAccounts(organizationId, merchantAccountId);

    // 1. Captures — items in matched / amount_mismatch states. provider
    // comes from the parent run; if NULL we fall back to 'generic' so
    // it maps to a real account in the chart.
    const captures = await client.query(
      `SELECT i.id, i.order_id, i.gateway_reference,
              i.order_amount::text AS order_amount,
              i.transaction_at,
              COALESCE(r.provider_id, 'generic') AS provider
         FROM reconciliation_items i
         JOIN reconciliation_runs r
           ON r.id = i.run_id AND r.organization_id = i.organization_id
        WHERE i.organization_id = $1
          AND i.reconciliation_status IN ('matched', 'amount_mismatch')`,
      [organizationId],
    );
    for (const row of captures.rows) {
      const result = await postCapture(
        organizationId,
        merchantAccountId,
        row.provider,
        row.id,
        Number(row.order_amount),
        row.transaction_at ?? new Date(),
        { orderId: row.order_id, gatewayReference: row.gateway_reference, provider: row.provider },
      );
      counts.captures[result] += 1;
    }

    // 2. Settlement batches — for each batch, replay its deductions +
    // bank credits + payout entries.
    const batches = await client.query(
      `SELECT id, provider_id, utr,
              COALESCE(actual_settlement_at, expected_settlement_at) AS effective_at,
              net_amount::text AS net_amount
         FROM merchant_settlement_batches
        WHERE organization_id = $1`,
      [organizationId],
    );
    for (const batch of batches.rows) {
      const batchId = batch.id;
      const provider = batch.provider_id;
      const utr = batch.utr;
      const effectiveAt = batch.effective_at;

      // 2a. Deductions
      const deductions = await client.query(
        `SELECT id, deduction_type, amount::text AS amount
           FROM merchant_settlement_deductions
          WHERE organization_id = $1 AND batch_id = $2`,
        [organizationId, batchId],
      );
      for (const ded of deductions.rows) {
        const amount = Number(ded.amount);
        const isGst = ded.deduction_type === "gst";
        const result = isGst
          ? await postGst(organizationId, merchantAccountId, provider, batchId, ded.id, amount, effectiveAt, utr)
          : await postFee(organizationId, merchantAccountId, provider, batchId, ded.id, ded.deduction_type, amount, effectiveAt, utr);
        if (isGst) counts.gsts[result] += 1;
        else counts.fees[result] += 1;
      }

      // 2b. Bank credits
      const credits = await client.query(
        `SELECT id, amount::text AS amount, credited_at
           FROM merchant_settlement_bank_credits
          WHERE organization_id = $1 AND batch_id = $2`,
        [organizationId, batchId],
      );
      for (const credit of credits.rows) {
        const result = await postBankCredit(
          organizationId, merchantAccountId, provider, batchId,
          credit.id, Number(credit.amount), credit.credited_at, utr,
        );
        counts.bankCredits[result] += 1;
      }

      // 2c. Payout (the net amount the batch settles to merchant)
      const netAmount = Number(batch.net_amount);
      if (netAmount > 0) {
        const result = await postPayout(
          organizationId, merchantAccountId, provider, batchId,
          netAmount, effectiveAt, utr,
        );
        counts.payouts[result] += 1;
      }
    }

    // 3. Refund netting — provider attribution via JOIN through parent
    // capture's run, matching the Bridge 3 resolution path.
    const refunds = await client.query(
      `SELECT a.id, a.refund_order_id, a.refund_external_reference,
              a.refund_amount::text AS amount,
              a.refund_settlement_at, a.refund_transaction_at,
              COALESCE(r.provider_id, 'generic') AS provider
         FROM reconciliation_refund_allocations a
         JOIN reconciliation_items i
           ON i.id = a.parent_item_id AND i.organization_id = a.organization_id
         JOIN reconciliation_runs r
           ON r.id = i.run_id AND r.organization_id = i.organization_id
        WHERE a.organization_id = $1 AND a.status = 'applied'`,
      [organizationId],
    );
    for (const refund of refunds.rows) {
      const effectiveAt =
        refund.refund_settlement_at ?? refund.refund_transaction_at ?? new Date();
      const result = await postRefundNetting(
        organizationId, merchantAccountId, refund.provider,
        refund.id, Number(refund.amount), effectiveAt,
        { refundOrderId: refund.refund_order_id, refundExternalReference: refund.refund_external_reference, provider: refund.provider },
      );
      counts.refundNettings[result] += 1;
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(`[backfill] org=${organizationId} FAILED:`, error.message);
    throw error;
  }

  return counts;
}

async function ensureLedgerAccounts(organizationId, merchantAccountId) {
  // Mirrors lib/modules/ledger/repository.ts:ensureLedgerAccountsForMerchant.
  // ON CONFLICT NULLS NOT DISTINCT (PG 15+) ensures NULL-provider rows
  // dedupe correctly on re-runs.
  await client.query(
    `INSERT INTO ledger_accounts
       (organization_id, merchant_account_id, account_role, account_type, provider)
     VALUES
       ($1, $2, 'merchant_payable', 'liability', NULL),
       ($1, $2, 'escrow_cash',      'asset',     NULL),
       ($1, $2, 'gst_liability',    'expense',   NULL),
       ($1, $2, 'refund_payable',   'liability', NULL)
     ON CONFLICT DO NOTHING`,
    [organizationId, merchantAccountId],
  );
  await client.query(
    `INSERT INTO ledger_accounts
       (organization_id, merchant_account_id, account_role, account_type, provider)
     SELECT $1, $2, role, type, prov
       FROM (VALUES
         ('provider_receivable', 'asset',   'razorpay_demo'),
         ('provider_receivable', 'asset',   'cashfree_demo'),
         ('provider_receivable', 'asset',   'payu_demo'),
         ('provider_receivable', 'asset',   'generic'),
         ('fee_expense',         'expense', 'razorpay_demo'),
         ('fee_expense',         'expense', 'cashfree_demo'),
         ('fee_expense',         'expense', 'payu_demo'),
         ('fee_expense',         'expense', 'generic')
       ) AS v(role, type, prov)
     ON CONFLICT DO NOTHING`,
    [organizationId, merchantAccountId],
  );
}

// --- Posting primitives -----------------------------------------------------
//
// Each returns "posted" if the transaction was newly inserted, "skipped" if
// the idempotency key already existed. Returns a string so the caller can
// `counts.foo[result] += 1` in one line.

async function getAccountId(organizationId, merchantAccountId, role, provider) {
  const result = await client.query(
    `SELECT id FROM ledger_accounts
      WHERE organization_id = $1 AND merchant_account_id = $2
        AND account_role = $3 AND provider IS NOT DISTINCT FROM $4
        AND currency = 'INR'`,
    [organizationId, merchantAccountId, role, provider],
  );
  if (!result.rowCount) {
    throw new Error(`Missing ledger account ${role}/${provider ?? "_"} for merchant ${merchantAccountId}`);
  }
  return result.rows[0].id;
}

async function tryInsertTransaction(input) {
  // Returns { id } if newly inserted; null if conflict.
  const result = await client.query(
    `INSERT INTO ledger_transactions (
       organization_id, source_type, source_id, source_batch_id,
       external_refs, effective_at, idempotency_key, description, reversal_of
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,NULL)
     ON CONFLICT (organization_id, idempotency_key) DO NOTHING
     RETURNING id`,
    [
      input.organizationId, input.sourceType, input.sourceId,
      input.sourceBatchId, JSON.stringify(input.externalRefs),
      input.effectiveAt, input.idempotencyKey, input.description,
    ],
  );
  return result.rows[0]?.id ?? null;
}

async function insertEntries(organizationId, transactionId, debitAccountId, creditAccountId, amount) {
  await client.query(
    `INSERT INTO ledger_entries
       (organization_id, transaction_id, account_id, direction, amount)
     VALUES
       ($1, $2, $3, 'debit',  $5),
       ($1, $2, $4, 'credit', $5)`,
    [organizationId, transactionId, debitAccountId, creditAccountId, amount],
  );
}

async function postCapture(orgId, merchantId, provider, itemId, amount, effectiveAt, externalRefs) {
  const txId = await tryInsertTransaction({
    organizationId: orgId,
    sourceType: "capture",
    sourceId: itemId,
    sourceBatchId: null,
    externalRefs,
    effectiveAt,
    idempotencyKey: `capture:${itemId}`,
    description: `Capture ₹${amount.toFixed(2)} via ${provider}`,
  });
  if (!txId) return "skipped";
  const debit = await getAccountId(orgId, merchantId, "provider_receivable", provider);
  const credit = await getAccountId(orgId, merchantId, "merchant_payable", null);
  await insertEntries(orgId, txId, debit, credit, amount);
  return "posted";
}

async function postFee(orgId, merchantId, provider, batchId, deductionId, deductionType, amount, effectiveAt, utr) {
  const txId = await tryInsertTransaction({
    organizationId: orgId,
    sourceType: "fee",
    sourceId: deductionId,
    sourceBatchId: batchId,
    externalRefs: { deductionType, provider, utr },
    effectiveAt,
    idempotencyKey: `fee:${deductionId}:${amount.toFixed(2)}`,
    description: `${deductionType.toUpperCase()} ₹${amount.toFixed(2)} via ${provider}`,
  });
  if (!txId) return "skipped";
  const debit = await getAccountId(orgId, merchantId, "fee_expense", provider);
  const credit = await getAccountId(orgId, merchantId, "provider_receivable", provider);
  await insertEntries(orgId, txId, debit, credit, amount);
  return "posted";
}

async function postGst(orgId, merchantId, provider, batchId, deductionId, amount, effectiveAt, utr) {
  const txId = await tryInsertTransaction({
    organizationId: orgId,
    sourceType: "gst",
    sourceId: deductionId,
    sourceBatchId: batchId,
    externalRefs: { deductionType: "gst", provider, utr },
    effectiveAt,
    idempotencyKey: `gst:${deductionId}:${amount.toFixed(2)}`,
    description: `GST ₹${amount.toFixed(2)} on ${provider} settlement`,
  });
  if (!txId) return "skipped";
  const debit = await getAccountId(orgId, merchantId, "gst_liability", null);
  const credit = await getAccountId(orgId, merchantId, "provider_receivable", provider);
  await insertEntries(orgId, txId, debit, credit, amount);
  return "posted";
}

async function postBankCredit(orgId, merchantId, provider, batchId, creditId, amount, creditedAt, utr) {
  const txId = await tryInsertTransaction({
    organizationId: orgId,
    sourceType: "bank_credit",
    sourceId: creditId,
    sourceBatchId: batchId,
    externalRefs: { utr, provider },
    effectiveAt: creditedAt,
    idempotencyKey: `bank_credit:${creditId}:${amount.toFixed(2)}`,
    description: `Bank credit ₹${amount.toFixed(2)} (UTR ${utr ?? "n/a"})`,
  });
  if (!txId) return "skipped";
  const debit = await getAccountId(orgId, merchantId, "escrow_cash", null);
  const credit = await getAccountId(orgId, merchantId, "provider_receivable", provider);
  await insertEntries(orgId, txId, debit, credit, amount);
  return "posted";
}

async function postPayout(orgId, merchantId, provider, batchId, amount, effectiveAt, utr) {
  const txId = await tryInsertTransaction({
    organizationId: orgId,
    sourceType: "payout",
    sourceId: batchId,
    sourceBatchId: batchId,
    externalRefs: { utr, provider },
    effectiveAt,
    idempotencyKey: `payout:${batchId}:${amount.toFixed(2)}`,
    description: `Payout ₹${amount.toFixed(2)} to merchant (UTR ${utr ?? "n/a"})`,
  });
  if (!txId) return "skipped";
  const debit = await getAccountId(orgId, merchantId, "merchant_payable", null);
  const credit = await getAccountId(orgId, merchantId, "escrow_cash", null);
  await insertEntries(orgId, txId, debit, credit, amount);
  return "posted";
}

async function postRefundNetting(orgId, merchantId, provider, allocationId, amount, effectiveAt, externalRefs) {
  const txId = await tryInsertTransaction({
    organizationId: orgId,
    sourceType: "refund_netting",
    sourceId: allocationId,
    sourceBatchId: null,
    externalRefs,
    effectiveAt,
    idempotencyKey: `refund_netting:${allocationId}`,
    description: `Refund ₹${amount.toFixed(2)} netted against capture`,
  });
  if (!txId) return "skipped";
  const debit = await getAccountId(orgId, merchantId, "merchant_payable", null);
  const credit = await getAccountId(orgId, merchantId, "provider_receivable", provider);
  await insertEntries(orgId, txId, debit, credit, amount);
  return "posted";
}
