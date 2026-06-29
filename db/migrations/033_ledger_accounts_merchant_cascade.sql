-- Slice 6c — relax ledger_accounts.merchant_account_id FK from RESTRICT
-- to CASCADE.
--
-- The original migration 032 used ON DELETE RESTRICT on the merchant
-- account FK as belt-and-suspenders. In practice this blocks a legitimate
-- operation: seed-merchant-settlements.mjs (and any future seed / fixture
-- cleanup) wipes merchant_accounts to re-seed, and the RESTRICT now stops
-- that DELETE because ledger_accounts reference the merchant.
--
-- CASCADE is the right semantics. If a merchant is deleted (admin
-- cleanup, test teardown, dev re-seed), the ledger entries for that
-- merchant are no longer meaningful — keeping them as orphans would
-- corrupt balance queries. The organization-level cascade already
-- removes them when an org is dropped; this just adds the merchant-level
-- cascade path the seed flow needs.
--
-- Append-only protection still holds: the trigger blocks UPDATE on
-- ledger_entries / ledger_transactions, which is the actual audit risk.
-- DELETE via cascade is an admin/seed operation and stays allowed (same
-- precedent as Slice 6a's design where we dropped the DELETE trigger on
-- ledger_entries for org-cascade reasons).

ALTER TABLE ledger_accounts
  DROP CONSTRAINT ledger_accounts_merchant_account_id_organization_id_fkey;

ALTER TABLE ledger_accounts
  ADD CONSTRAINT ledger_accounts_merchant_account_id_organization_id_fkey
  FOREIGN KEY (merchant_account_id, organization_id)
  REFERENCES merchant_accounts(id, organization_id) ON DELETE CASCADE;
