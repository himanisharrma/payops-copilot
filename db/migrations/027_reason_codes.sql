-- Matching Engine v2, Slice 2: reason-code taxonomy.
-- Adds a finer-grained diagnosis alongside the existing reconciliation_status
-- outcome. Reason code is orthogonal to status: an amount_mismatch item could
-- be fee_mismatch, gst_mismatch, or unmatched_other. See gaps.md P4 and
-- lib/modules/reconciliation/reason-codes.ts for the classifier + policy map.
--
-- All 10 codes are reserved in the CHECK constraint; 5 are populated in-engine
-- during reconcilePayments() (timing_not_due, utr_missing, fee_mismatch,
-- gst_mismatch, unmatched_other), and 5 are populated post-persist by joining
-- to merchant_settlement_batches and payment_workflows (utr_duplicate,
-- hold_unexplained, payout_failed, chargeback_pending_recovery,
-- refund_not_adjusted). NULL means "not yet classified".

ALTER TABLE reconciliation_items
  ADD COLUMN reason_code TEXT
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
      'unmatched_other'
    ));

CREATE INDEX reconciliation_items_reason_code_idx
  ON reconciliation_items (organization_id, reason_code)
  WHERE reason_code IS NOT NULL;
