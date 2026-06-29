import type { PoolClient } from "pg";
import type {
  AccountRole,
  AccountType,
  EntryDirection,
  LedgerAccount,
  LedgerEntry,
  LedgerTransaction,
  ProviderId,
  SourceType,
} from "./types";

// SQL-only. Every fn takes a PoolClient + organizationId and threads
// organization_id into every WHERE clause. No business logic here.

export async function findTransactionByIdempotencyKey(
  client: PoolClient,
  organizationId: string,
  idempotencyKey: string,
): Promise<{ id: string } | null> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM ledger_transactions
      WHERE organization_id = $1 AND idempotency_key = $2`,
    [organizationId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

export async function insertLedgerTransaction(
  client: PoolClient,
  input: {
    organizationId: string;
    sourceType: SourceType;
    sourceId: string | null;
    sourceBatchId: string | null;
    externalRefs: Record<string, unknown>;
    effectiveAt: Date;
    idempotencyKey: string;
    description: string | null;
    reversalOf: string | null;
  },
): Promise<{ id: string }> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO ledger_transactions (
       organization_id, source_type, source_id, source_batch_id,
       external_refs, effective_at, idempotency_key, description, reversal_of
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)
     RETURNING id`,
    [
      input.organizationId,
      input.sourceType,
      input.sourceId,
      input.sourceBatchId,
      JSON.stringify(input.externalRefs),
      input.effectiveAt,
      input.idempotencyKey,
      input.description,
      input.reversalOf,
    ],
  );
  return result.rows[0];
}

export async function insertLedgerEntries(
  client: PoolClient,
  organizationId: string,
  transactionId: string,
  entries: Array<{
    accountId: string;
    direction: EntryDirection;
    amount: number;
  }>,
): Promise<{ inserted: number }> {
  if (entries.length === 0) return { inserted: 0 };
  // Build a single multi-row INSERT for the entry pair (or N-way split).
  const placeholders: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const entry of entries) {
    placeholders.push(
      `($${i++}, $${i++}, $${i++}, $${i++}, $${i++})`,
    );
    values.push(
      organizationId,
      transactionId,
      entry.accountId,
      entry.direction,
      entry.amount,
    );
  }
  const result = await client.query(
    `INSERT INTO ledger_entries (
       organization_id, transaction_id, account_id, direction, amount
     ) VALUES ${placeholders.join(",")}`,
    values,
  );
  return { inserted: result.rowCount ?? 0 };
}

export async function getAccountsForMerchant(
  client: PoolClient,
  organizationId: string,
  merchantAccountId: string,
): Promise<LedgerAccount[]> {
  const result = await client.query<{
    id: string;
    merchant_account_id: string;
    account_role: AccountRole;
    account_type: AccountType;
    provider: ProviderId | null;
    currency: "INR";
    created_at: Date;
  }>(
    `SELECT id, merchant_account_id, account_role, account_type,
            provider, currency, created_at
       FROM ledger_accounts
      WHERE organization_id = $1 AND merchant_account_id = $2`,
    [organizationId, merchantAccountId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    merchantAccountId: row.merchant_account_id,
    accountRole: row.account_role,
    accountType: row.account_type,
    provider: row.provider,
    currency: row.currency,
    createdAt: row.created_at.toISOString(),
  }));
}

// Lazily provision the 6-role chart for a merchant. Idempotent — ON
// CONFLICT DO NOTHING matches the migration seed pattern.
export async function ensureLedgerAccountsForMerchant(
  client: PoolClient,
  organizationId: string,
  merchantAccountId: string,
): Promise<void> {
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

// Hot SUM path. Composite index on
// (organization_id, account_id, transaction_id) + the transactions
// index on (organization_id, effective_at) make this cheap for
// synthetic-data scale. Per gaps.md, snapshot table only when p95 > 500ms.
export async function sumEntriesAsOf(
  client: PoolClient,
  organizationId: string,
  merchantAccountId: string,
  asOf: Date,
  options: { from?: Date } = {},
): Promise<
  Array<{
    accountId: string;
    accountRole: AccountRole;
    accountType: AccountType;
    provider: ProviderId | null;
    debit: number;
    credit: number;
  }>
> {
  // We pre-filter entries via an INNER JOIN to ledger_transactions so
  // future-effective entries are excluded BEFORE the LEFT JOIN to
  // accounts. Putting effective_at in the LEFT JOIN's ON clause is a
  // foot-gun: LEFT JOIN preserves entries whose join target is NULL,
  // so the filtered entries would still get SUMmed against their
  // account. Subquery is the clean fix.
  const params: unknown[] = [organizationId, merchantAccountId, asOf];
  let fromClause = "";
  if (options.from) {
    params.push(options.from);
    fromClause = `AND t.effective_at > $${params.length}`;
  }
  const result = await client.query<{
    account_id: string;
    account_role: AccountRole;
    account_type: AccountType;
    provider: ProviderId | null;
    debit: string;
    credit: string;
  }>(
    `SELECT a.id AS account_id,
            a.account_role,
            a.account_type,
            a.provider,
            COALESCE(SUM(CASE WHEN filtered.direction = 'debit'  THEN filtered.amount END), 0)::text AS debit,
            COALESCE(SUM(CASE WHEN filtered.direction = 'credit' THEN filtered.amount END), 0)::text AS credit
       FROM ledger_accounts a
       LEFT JOIN (
         SELECT e.account_id, e.direction, e.amount
           FROM ledger_entries e
           JOIN ledger_transactions t
             ON t.id = e.transaction_id
            AND t.organization_id = e.organization_id
          WHERE e.organization_id = $1
            AND t.effective_at <= $3
            ${fromClause}
       ) filtered
         ON filtered.account_id = a.id
      WHERE a.organization_id = $1
        AND a.merchant_account_id = $2
   GROUP BY a.id, a.account_role, a.account_type, a.provider
   ORDER BY a.account_role, a.provider NULLS FIRST`,
    params,
  );
  return result.rows.map((row) => ({
    accountId: row.account_id,
    accountRole: row.account_role,
    accountType: row.account_type,
    provider: row.provider,
    debit: Number(row.debit),
    credit: Number(row.credit),
  }));
}

export async function listTransactionsForMerchant(
  client: PoolClient,
  organizationId: string,
  filters: {
    merchantAccountId: string;
    from: Date;
    to: Date;
    cursor?: { effectiveAt: Date; id: string };
    limit: number;
  },
): Promise<{
  transactions: LedgerTransaction[];
  nextCursor: { effectiveAt: string; id: string } | null;
}> {
  // Keyset pagination on (effective_at DESC, id). The merchant filter
  // restricts to transactions that touch any of the merchant's
  // accounts; cheap because of ledger_accounts_merchant_idx.
  const params: unknown[] = [
    organizationId,
    filters.merchantAccountId,
    filters.from,
    filters.to,
  ];
  let cursorClause = "";
  if (filters.cursor) {
    params.push(filters.cursor.effectiveAt, filters.cursor.id);
    cursorClause = `AND (t.effective_at, t.id) < ($${params.length - 1}, $${params.length})`;
  }
  params.push(filters.limit + 1);
  const txRows = await client.query<{
    id: string;
    source_type: SourceType;
    source_id: string | null;
    source_batch_id: string | null;
    external_refs: Record<string, unknown>;
    effective_at: Date;
    posted_at: Date;
    idempotency_key: string;
    description: string | null;
    reversal_of: string | null;
  }>(
    `SELECT DISTINCT t.id, t.source_type, t.source_id, t.source_batch_id,
            t.external_refs, t.effective_at, t.posted_at,
            t.idempotency_key, t.description, t.reversal_of
       FROM ledger_transactions t
       JOIN ledger_entries e
         ON e.transaction_id = t.id AND e.organization_id = t.organization_id
       JOIN ledger_accounts a
         ON a.id = e.account_id AND a.organization_id = e.organization_id
      WHERE t.organization_id = $1
        AND a.merchant_account_id = $2
        AND t.effective_at >= $3
        AND t.effective_at <= $4
        ${cursorClause}
   ORDER BY t.effective_at DESC, t.id DESC
      LIMIT $${params.length}`,
    params,
  );
  const rows = txRows.rows;
  const hasMore = rows.length > filters.limit;
  const page = hasMore ? rows.slice(0, filters.limit) : rows;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? { effectiveAt: last.effective_at.toISOString(), id: last.id }
      : null;
  if (page.length === 0) {
    return { transactions: [], nextCursor: null };
  }
  const txIds = page.map((row) => row.id);
  const entryRows = await client.query<{
    id: string;
    transaction_id: string;
    account_id: string;
    account_role: AccountRole;
    provider: ProviderId | null;
    direction: EntryDirection;
    amount: string;
    created_at: Date;
  }>(
    `SELECT e.id, e.transaction_id, e.account_id,
            a.account_role, a.provider,
            e.direction, e.amount::text AS amount, e.created_at
       FROM ledger_entries e
       JOIN ledger_accounts a
         ON a.id = e.account_id AND a.organization_id = e.organization_id
      WHERE e.organization_id = $1 AND e.transaction_id = ANY($2::uuid[])
   ORDER BY e.transaction_id, e.created_at`,
    [organizationId, txIds],
  );
  const entriesByTx = new Map<string, LedgerEntry[]>();
  for (const er of entryRows.rows) {
    const list = entriesByTx.get(er.transaction_id) ?? [];
    list.push({
      id: er.id,
      transactionId: er.transaction_id,
      accountId: er.account_id,
      accountRole: er.account_role,
      provider: er.provider,
      direction: er.direction,
      amount: Number(er.amount),
      currency: "INR",
      createdAt: er.created_at.toISOString(),
    });
    entriesByTx.set(er.transaction_id, list);
  }
  const transactions: LedgerTransaction[] = page.map((row) => ({
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceBatchId: row.source_batch_id,
    externalRefs: row.external_refs,
    effectiveAt: row.effective_at.toISOString(),
    postedAt: row.posted_at.toISOString(),
    idempotencyKey: row.idempotency_key,
    description: row.description,
    reversalOf: row.reversal_of,
    entries: entriesByTx.get(row.id) ?? [],
  }));
  return { transactions, nextCursor };
}

export async function loadTransactionWithEntries(
  client: PoolClient,
  organizationId: string,
  transactionId: string,
): Promise<LedgerTransaction | null> {
  const txResult = await client.query<{
    id: string;
    source_type: SourceType;
    source_id: string | null;
    source_batch_id: string | null;
    external_refs: Record<string, unknown>;
    effective_at: Date;
    posted_at: Date;
    idempotency_key: string;
    description: string | null;
    reversal_of: string | null;
  }>(
    `SELECT id, source_type, source_id, source_batch_id,
            external_refs, effective_at, posted_at,
            idempotency_key, description, reversal_of
       FROM ledger_transactions
      WHERE organization_id = $1 AND id = $2`,
    [organizationId, transactionId],
  );
  const tx = txResult.rows[0];
  if (!tx) return null;
  const entryResult = await client.query<{
    id: string;
    transaction_id: string;
    account_id: string;
    account_role: AccountRole;
    provider: ProviderId | null;
    direction: EntryDirection;
    amount: string;
    created_at: Date;
  }>(
    `SELECT e.id, e.transaction_id, e.account_id,
            a.account_role, a.provider,
            e.direction, e.amount::text AS amount, e.created_at
       FROM ledger_entries e
       JOIN ledger_accounts a
         ON a.id = e.account_id AND a.organization_id = e.organization_id
      WHERE e.organization_id = $1 AND e.transaction_id = $2
   ORDER BY e.created_at`,
    [organizationId, transactionId],
  );
  return {
    id: tx.id,
    sourceType: tx.source_type,
    sourceId: tx.source_id,
    sourceBatchId: tx.source_batch_id,
    externalRefs: tx.external_refs,
    effectiveAt: tx.effective_at.toISOString(),
    postedAt: tx.posted_at.toISOString(),
    idempotencyKey: tx.idempotency_key,
    description: tx.description,
    reversalOf: tx.reversal_of,
    entries: entryResult.rows.map((er) => ({
      id: er.id,
      transactionId: er.transaction_id,
      accountId: er.account_id,
      accountRole: er.account_role,
      provider: er.provider,
      direction: er.direction,
      amount: Number(er.amount),
      currency: "INR",
      createdAt: er.created_at.toISOString(),
    })),
  };
}
