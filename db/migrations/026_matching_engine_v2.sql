-- Matching Engine v2, Slice 1: layered matching strategies + confidence tier.
-- Stamps every reconciliation_items row with the strategy that found the match
-- and a confidence tier. Existing rows from prior runs stay valid (nullable).
-- See lib/modules/reconciliation/strategies.ts for the tier mapping.

ALTER TABLE reconciliation_items
  ADD COLUMN match_strategy TEXT
    CHECK (match_strategy IN (
      'exact_order_id',
      'gateway_reference_fallback',
      'amount_date_window',
      'unmatched'
    )),
  ADD COLUMN match_confidence TEXT
    CHECK (match_confidence IN ('exact', 'high', 'medium', 'low', 'none'));

CREATE INDEX reconciliation_items_match_strategy_idx
  ON reconciliation_items (organization_id, match_strategy);
