-- Slice 2b: index on (organization_id, order_id) for the cross-table reason-code
-- backfill + service-hook UPDATEs. The hook helper joins reconciliation_items.order_id
-- -> merchant_settlement_lines.order_id many times per refresh; without this index
-- the lines table is scanned, which dominates the hook's cost as data grows.

CREATE INDEX merchant_settlement_lines_org_order_idx
  ON merchant_settlement_lines (organization_id, order_id);
