-- Matching Engine v2, Slice 4: many-to-one payout sum checks.
--
-- One bank credit / one UTR / one provider settlement_id aggregates many
-- payment items. Real Indian aggregators (Razorpay Optimizer, Cashfree,
-- PayU, Paytm) ship per-item settlement reports keyed by a payout/settlement
-- ID; the real reconciliation failure mode is "sum of items the provider
-- claims they settled does not equal the money that actually landed in the
-- bank." See gaps.md gap 3.
--
-- This migration adds:
--   1. `reconciliation_items.payout_id` — provider statement_reference / payout
--      ID stamped by the engine from the settlement CSV. Nullable; not all
--      adapters / runs supply it (and items with no settlement row never have
--      one).
--   2. A new `payout_sum_mismatch` reason code (11 codes total). Group-level
--      verdict applied by `refreshPayoutSumChecks` in
--      lib/modules/reconciliation/reason-codes.ts. It takes precedence over
--      per-item codes — see the precedence guard on
--      `refreshReasonCodesForOrders`.
--   3. A partial index on `(organization_id, payout_id)` to keep group lookups
--      cheap without bloating the index for legacy items.
--
-- No backfill: the engine starts writing `payout_id` on the next reconciliation
-- run. Re-running reconciliation is the only path to populate historical
-- items.

ALTER TABLE reconciliation_items ADD COLUMN payout_id TEXT;

ALTER TABLE reconciliation_items
  DROP CONSTRAINT reconciliation_items_reason_code_check;

ALTER TABLE reconciliation_items
  ADD CONSTRAINT reconciliation_items_reason_code_check
  CHECK (reason_code IS NULL OR reason_code IN (
    'timing_not_due',
    'utr_missing',
    'utr_duplicate',
    'fee_mismatch',
    'gst_mismatch',
    'hold_unexplained',
    'payout_failed',
    'chargeback_pending_recovery',
    'refund_not_adjusted',
    'unmatched_other',
    'payout_sum_mismatch'
  ));

CREATE INDEX reconciliation_items_payout_idx
  ON reconciliation_items (organization_id, payout_id)
  WHERE payout_id IS NOT NULL;
