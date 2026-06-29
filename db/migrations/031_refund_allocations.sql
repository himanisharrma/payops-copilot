-- Matching Engine v2, Slice 5: refund netting in the matching engine.
--
-- Real Indian aggregators (Razorpay, Cashfree, PayU, Paytm — verified via
-- their settlement reconciliation docs) emit refunds as separate
-- negative-amount lines keyed to the original Order ID, deducted from
-- subsequent settlement batches. PayOps's engine today doesn't recognize
-- that pattern; this migration adds the persistence layer for it.
--
-- Architecture: the engine row stays immutable as the engine's verdict
-- (just like Slice 3 manual overrides and Slice 4 payout sum checks).
-- Refund allocations live in their own side table, linked by composite
-- FK to the parent reconciliation_item. Effective state (engine variance
-- + sum of allocated refunds) is composed at read time. Validated against
-- immutable-ledger best practice: "append correcting entries, don't
-- update payment amounts."
--
-- This migration:
--   1. Creates `reconciliation_refund_allocations` (one row per refund
--      settlement-line, linked to its parent capture item).
--   2. Adds idempotency via UNIQUE on (organization_id,
--      refund_external_reference, parent_item_id) WHERE status =
--      'applied'. Re-running the refresh on the same refund candidate
--      produces exactly one allocation row.
--   3. Adds the 12th reason code `refund_offset_recognized`. Stamped on
--      the parent item by `refreshRefundAllocations` when effective
--      variance lands within ₹0.01. Precedence: lower than
--      `payout_sum_mismatch` (group-level wins), higher than per-item
--      codes.
--   4. Ensures cross-run parent lookup is indexed by
--      (organization_id, order_id).

CREATE TABLE reconciliation_refund_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_item_id UUID NOT NULL,
  parent_run_id UUID NOT NULL,
  refund_source_run_id UUID NOT NULL,
  refund_external_reference TEXT NOT NULL
    CHECK (LENGTH(BTRIM(refund_external_reference)) > 0),
  refund_order_id TEXT NOT NULL
    CHECK (LENGTH(BTRIM(refund_order_id)) > 0),
  refund_amount NUMERIC(14, 2) NOT NULL CHECK (refund_amount > 0),
  refund_transaction_at TIMESTAMPTZ,
  refund_settlement_at TIMESTAMPTZ,
  refund_utr TEXT,
  refund_statement_reference TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('applied', 'superseded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, organization_id),
  FOREIGN KEY (parent_item_id, parent_run_id, organization_id)
    REFERENCES reconciliation_items(id, run_id, organization_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX reconciliation_refund_allocations_idem_idx
  ON reconciliation_refund_allocations
    (organization_id, refund_external_reference, parent_item_id)
  WHERE status = 'applied';

CREATE INDEX reconciliation_refund_allocations_parent_idx
  ON reconciliation_refund_allocations (organization_id, parent_item_id);

-- Extend reason_code CHECK to 12 values.
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
    'payout_sum_mismatch',
    'refund_offset_recognized'
  ));

-- Cross-run parent lookup support. Slice 5 finds an item's parent
-- capture by (organization_id, order_id) across all runs.
CREATE INDEX IF NOT EXISTS reconciliation_items_org_order_idx
  ON reconciliation_items (organization_id, order_id);
