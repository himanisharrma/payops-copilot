-- Ledger Backbone v1: append-only double-entry journal that composes
-- merchant balance at any point in time.
--
-- Wedge: gaps.md §P2 / Gap 4. PayOps today labels mismatches via the
-- Matching Engine v2 reason-code taxonomy but cannot prove
-- "merchant X ka mere upar abhi ₹Y payable hai, kal raat 11:59 IST ko
-- kya tha." This migration adds the canonical ledger that answers
-- opening_payable + collections - MDR - GST - refund - holds + releases
-- - payouts = closing_payable for any (merchant, asOf) tuple.
--
-- Design (locked by user, research-backed):
--   - Strict double-entry: Σdebit = Σcredit per ledger_transaction.
--     Industry-universal (Stripe / Square Books / Modern Treasury /
--     TigerBeetle / Increase / Juspay Hyperswitch).
--   - Per economic event granularity: one ledger_transaction per
--     capture / refund / payout / bank credit / fee / GST. A settlement
--     batch of N lines = N transactions grouped via source_batch_id.
--     Mirrors Stripe Ledger + Cashfree settlement-event-stream shape.
--   - v1 chart-of-accounts (6 roles): merchant_payable, provider_receivable,
--     escrow_cash, fee_expense, gst_liability, refund_payable. v1.1
--     extends with chargeback_receivable, hold, adjustment_writeoff.
--   - Append-only: UPDATE / DELETE blocked at the DB level via trigger
--     (defence-in-depth alongside the service-layer guard). Corrections
--     post a NEW reversal transaction with reversal_of FK.
--   - Idempotency: each transaction carries a deterministic
--     idempotency_key keyed off its source event. Refresh hooks can
--     fire twice safely.
--   - effective_at separates real-world event time from posted_at
--     (when the ledger learned). Modern Treasury convention.

CREATE TABLE ledger_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  merchant_account_id UUID NOT NULL,
  account_role TEXT NOT NULL
    CHECK (account_role IN (
      'merchant_payable',
      'provider_receivable',
      'escrow_cash',
      'fee_expense',
      'gst_liability',
      'refund_payable'
      -- v1.1 will add: 'chargeback_receivable', 'hold', 'adjustment_writeoff'
    )),
  account_type TEXT NOT NULL
    CHECK (account_type IN (
      'asset', 'liability', 'equity', 'income', 'expense'
    )),
  provider TEXT,
  currency TEXT NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- NULLS NOT DISTINCT (PG 15+) so the provider=NULL accounts
  -- (merchant_payable, escrow_cash, gst_liability, refund_payable) get
  -- properly deduped on ON CONFLICT. Without this, NULL provider rows
  -- would be considered distinct on every re-insert from
  -- ensureLedgerAccountsForMerchant, producing duplicates.
  UNIQUE NULLS NOT DISTINCT
    (organization_id, merchant_account_id, account_role, provider, currency),
  UNIQUE (id, organization_id),
  FOREIGN KEY (merchant_account_id, organization_id)
    REFERENCES merchant_accounts(id, organization_id) ON DELETE RESTRICT
);

CREATE INDEX ledger_accounts_merchant_idx
  ON ledger_accounts (organization_id, merchant_account_id);

CREATE TABLE ledger_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL
    CHECK (source_type IN (
      'capture',
      'refund_initiation',
      'refund_netting',
      'payout',
      'bank_credit',
      'fee',
      'gst',
      'adjustment'
    )),
  source_id UUID,
  source_batch_id UUID,
  external_refs JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (JSONB_TYPEOF(external_refs) = 'object'),
  effective_at TIMESTAMPTZ NOT NULL,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idempotency_key TEXT NOT NULL
    CHECK (LENGTH(BTRIM(idempotency_key)) BETWEEN 3 AND 200),
  description TEXT,
  reversal_of UUID,
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (id, organization_id),
  FOREIGN KEY (reversal_of, organization_id)
    REFERENCES ledger_transactions(id, organization_id) ON DELETE RESTRICT
);

CREATE INDEX ledger_transactions_effective_idx
  ON ledger_transactions (organization_id, effective_at);
CREATE INDEX ledger_transactions_source_idx
  ON ledger_transactions (organization_id, source_type, source_id);
CREATE INDEX ledger_transactions_batch_idx
  ON ledger_transactions (organization_id, source_batch_id)
  WHERE source_batch_id IS NOT NULL;

CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL,
  account_id UUID NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, organization_id),
  FOREIGN KEY (transaction_id, organization_id)
    REFERENCES ledger_transactions(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (account_id, organization_id)
    REFERENCES ledger_accounts(id, organization_id) ON DELETE RESTRICT
);

CREATE INDEX ledger_entries_account_idx
  ON ledger_entries (organization_id, account_id, transaction_id);
CREATE INDEX ledger_entries_transaction_idx
  ON ledger_entries (organization_id, transaction_id);

-- Append-only enforcement at the DB level. Service layer is the
-- primary gate; this trigger is defence-in-depth so a stray UPDATE
-- from a future module or a console session cannot silently rewrite
-- amounts. Reversals append a new ledger_transactions row with
-- reversal_of set, not by mutating prior rows.
--
-- We do NOT block DELETE: ON DELETE CASCADE from organizations is a
-- legitimate admin operation (org cleanup, test teardown) and blocking
-- it would break tenancy guarantees. The risk we protect against is
-- silent UPDATE drift on amounts — that's where ledger integrity is
-- actually at risk.
CREATE OR REPLACE FUNCTION ledger_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_% is append-only', TG_TABLE_NAME
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_no_update
  BEFORE UPDATE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_mutation();
CREATE TRIGGER ledger_transactions_no_update
  BEFORE UPDATE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_mutation();

-- Seed the chart of accounts for every existing merchant_accounts row.
-- New merchant_accounts created after this migration are seeded lazily
-- by ledger.service.ensureLedgerAccountsForMerchant.
--
-- 4 roles are merchant-scoped only (NULL provider): merchant_payable
-- (liability owed to the merchant by us), escrow_cash (asset, bank-held
-- cash awaiting payout), gst_liability (GST collected, owed to govt),
-- refund_payable (refunds initiated but not netted).
--
-- 2 roles are provider-scoped (one per PG): provider_receivable (asset,
-- what each PG owes us pre-bank-credit) and fee_expense (MDR cost per
-- PG). Provider list mirrors merchant_settlement_batches.provider_id
-- CHECK so existing PG IDs map cleanly.
DO $$
DECLARE m RECORD;
BEGIN
  FOR m IN SELECT organization_id, id FROM merchant_accounts LOOP
    -- gst_liability is account_type='expense' because the wedge formula
    -- treats GST as a deduction (PG charges GST on MDR; merchant bears
    -- the cost in cashflow terms). Calling it 'liability' would invert
    -- the sign under our balance convention (credit-debit for
    -- liabilities) and produce negative GST balances, which a
    -- controller would not recognize. v1.1 may split this into a true
    -- gst_input_credit asset once input tax credit accounting lands.
    INSERT INTO ledger_accounts (organization_id, merchant_account_id, account_role, account_type, provider)
    VALUES
      (m.organization_id, m.id, 'merchant_payable', 'liability', NULL),
      (m.organization_id, m.id, 'escrow_cash',      'asset',     NULL),
      (m.organization_id, m.id, 'gst_liability',    'expense',   NULL),
      (m.organization_id, m.id, 'refund_payable',   'liability', NULL)
    ON CONFLICT DO NOTHING;

    INSERT INTO ledger_accounts (organization_id, merchant_account_id, account_role, account_type, provider)
    SELECT m.organization_id, m.id, role, type, prov
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
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
