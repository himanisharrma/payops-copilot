import type { PoolClient } from "pg";
import { recordAuditEvent } from "@/lib/modules/audit/repository";
import { DomainError } from "@/lib/modules/errors";
import {
  assertBalanced,
  bankCreditToPlan,
  captureToPlan,
  feeToPlan,
  gstToPlan,
  payoutToPlan,
  refundNettingToPlan,
  type EntryPlan,
  type TransactionPlan,
} from "./posting-recipes";
import {
  ensureLedgerAccountsForMerchant as ensureAccountsRepo,
  findTransactionByIdempotencyKey,
  getAccountsForMerchant,
  insertLedgerEntries,
  insertLedgerTransaction,
  listTransactionsForMerchant,
  loadTransactionWithEntries,
  sumEntriesAsOf,
} from "./repository";
import type {
  AccountRole,
  Actor,
  BalanceRow,
  CaptureSource,
  LedgerAccount,
  LedgerTransaction,
  PostResult,
  ProviderId,
  RefundAllocationSource,
  SettlementSource,
} from "./types";

// Ledger Backbone v1 service layer.
//
// Responsibilities:
//   - Apply posting-recipes to translate source events into balanced
//     transaction plans.
//   - Idempotency-check via deterministic key; skip already-posted.
//   - Resolve (accountRole, provider) → account_id from the merchant's
//     chart of accounts.
//   - Insert ledger_transactions + ledger_entries inside the caller's
//     transaction (callers always pass `client`).
//   - Write audit events for posting + reversal so the audit trail
//     mirrors every money movement in the ledger.
//   - Provide the read-side API: getBalance (with formula breakdown),
//     listTransactions, reverseTransaction.
//
// Boundary: the service never sees raw provider payloads — bridges in
// `reconciliation/`, `merchant-settlements/`, `refund-allocations/`
// (Slice 6b) translate their domain rows into the typed *Source inputs.

const PROVIDER_AGNOSTIC_ROLES: ReadonlySet<AccountRole> = new Set([
  "merchant_payable",
  "escrow_cash",
  "gst_liability",
  "refund_payable",
]);

type AccountIndex = Map<string, LedgerAccount>;

function accountKey(role: AccountRole, provider: ProviderId | null): string {
  return `${role}::${PROVIDER_AGNOSTIC_ROLES.has(role) ? "_" : (provider ?? "_")}`;
}

function indexAccounts(accounts: LedgerAccount[]): AccountIndex {
  const map: AccountIndex = new Map();
  for (const account of accounts) {
    const provider = PROVIDER_AGNOSTIC_ROLES.has(account.accountRole)
      ? null
      : account.provider;
    map.set(accountKey(account.accountRole, provider), account);
  }
  return map;
}

function resolveAccountId(
  index: AccountIndex,
  entry: EntryPlan,
): string {
  const key = accountKey(entry.accountRole, entry.provider);
  const account = index.get(key);
  if (!account) {
    throw new DomainError(
      `ledger_account_missing: ${entry.accountRole} provider=${
        entry.provider ?? "—"
      }. Did you call ensureLedgerAccountsForMerchant first?`,
      503,
    );
  }
  return account.id;
}

async function postPlans(
  client: PoolClient,
  organizationId: string,
  merchantAccountId: string,
  plans: TransactionPlan[],
  actor: Actor,
  auditAction: string,
): Promise<PostResult> {
  if (plans.length === 0) {
    return {
      transactionsPosted: 0,
      transactionsSkippedIdempotent: 0,
      entriesWritten: 0,
    };
  }

  await ensureAccountsRepo(client, organizationId, merchantAccountId);
  const accounts = await getAccountsForMerchant(
    client,
    organizationId,
    merchantAccountId,
  );
  const index = indexAccounts(accounts);

  let posted = 0;
  let skipped = 0;
  let entries = 0;

  for (const plan of plans) {
    assertBalanced(plan);
    const existing = await findTransactionByIdempotencyKey(
      client,
      organizationId,
      plan.idempotencyKey,
    );
    if (existing) {
      skipped += 1;
      continue;
    }
    const resolved = plan.entries.map((entry) => ({
      accountId: resolveAccountId(index, entry),
      direction: entry.direction,
      amount: entry.amount,
    }));
    const { id } = await insertLedgerTransaction(client, {
      organizationId,
      sourceType: plan.sourceType,
      sourceId: plan.sourceId,
      sourceBatchId: plan.sourceBatchId,
      externalRefs: plan.externalRefs,
      effectiveAt: plan.effectiveAt,
      idempotencyKey: plan.idempotencyKey,
      description: plan.description,
      reversalOf: null,
    });
    const { inserted } = await insertLedgerEntries(
      client,
      organizationId,
      id,
      resolved,
    );
    posted += 1;
    entries += inserted;
  }

  const result: PostResult = {
    transactionsPosted: posted,
    transactionsSkippedIdempotent: skipped,
    entriesWritten: entries,
  };

  await recordAuditEvent(
    {
      organizationId,
      actorUserId: actor.id,
      actorName: actor.name,
      action: auditAction,
      entityType: "merchant_account",
      entityId: merchantAccountId,
      details: { ...result, plansEvaluated: plans.length },
    },
    client,
  );

  return result;
}

export async function ensureLedgerAccountsForMerchant(
  client: PoolClient,
  organizationId: string,
  merchantAccountId: string,
): Promise<void> {
  await ensureAccountsRepo(client, organizationId, merchantAccountId);
}

export async function postCaptureEntries(
  client: PoolClient,
  organizationId: string,
  captures: CaptureSource[],
  actor: Actor,
): Promise<PostResult> {
  if (captures.length === 0) {
    return { transactionsPosted: 0, transactionsSkippedIdempotent: 0, entriesWritten: 0 };
  }
  // Captures all target a single merchantAccountId in v1 (single
  // synthetic demo merchant per org). Group + post per merchant so
  // multi-merchant graduation is mechanical.
  const grouped = new Map<string, CaptureSource[]>();
  for (const cap of captures) {
    const list = grouped.get(cap.merchantAccountId) ?? [];
    list.push(cap);
    grouped.set(cap.merchantAccountId, list);
  }
  const totals: PostResult = {
    transactionsPosted: 0,
    transactionsSkippedIdempotent: 0,
    entriesWritten: 0,
  };
  for (const [merchantAccountId, group] of grouped) {
    const plans = group.map(captureToPlan);
    const result = await postPlans(
      client,
      organizationId,
      merchantAccountId,
      plans,
      actor,
      "ledger.captures_posted",
    );
    totals.transactionsPosted += result.transactionsPosted;
    totals.transactionsSkippedIdempotent += result.transactionsSkippedIdempotent;
    totals.entriesWritten += result.entriesWritten;
  }
  return totals;
}

export async function postSettlementEntries(
  client: PoolClient,
  organizationId: string,
  source: SettlementSource,
  actor: Actor,
): Promise<PostResult> {
  const plans: TransactionPlan[] = [];
  for (const deduction of source.deductions) {
    if (deduction.type === "gst") {
      plans.push(
        gstToPlan({
          deduction,
          batchId: source.batchId,
          provider: source.provider,
          effectiveAt: source.effectiveAt,
          utr: source.utr,
        }),
      );
    } else {
      // Slice 6a posts MDR / commission / refund / chargeback /
      // adjustment / hold_release / rounding / rental / subscription /
      // recovery / hold all as fee_expense entries. v1.1 splits
      // chargeback / hold / adjustment into their own accounts.
      plans.push(
        feeToPlan({
          deduction,
          batchId: source.batchId,
          provider: source.provider,
          effectiveAt: source.effectiveAt,
          utr: source.utr,
        }),
      );
    }
  }
  for (const credit of source.bankCredits) {
    plans.push(
      bankCreditToPlan({
        credit,
        batchId: source.batchId,
        provider: source.provider,
        utr: source.utr,
      }),
    );
  }
  if (source.netAmount > 0) {
    plans.push(
      payoutToPlan({
        batchId: source.batchId,
        amount: source.netAmount,
        provider: source.provider,
        effectiveAt: source.effectiveAt,
        utr: source.utr,
      }),
    );
  }
  return postPlans(
    client,
    organizationId,
    source.merchantAccountId,
    plans,
    actor,
    "ledger.settlement_posted",
  );
}

export async function postRefundNettingEntries(
  client: PoolClient,
  organizationId: string,
  allocations: RefundAllocationSource[],
  actor: Actor,
): Promise<PostResult> {
  if (allocations.length === 0) {
    return { transactionsPosted: 0, transactionsSkippedIdempotent: 0, entriesWritten: 0 };
  }
  const grouped = new Map<string, RefundAllocationSource[]>();
  for (const allocation of allocations) {
    const list = grouped.get(allocation.merchantAccountId) ?? [];
    list.push(allocation);
    grouped.set(allocation.merchantAccountId, list);
  }
  const totals: PostResult = {
    transactionsPosted: 0,
    transactionsSkippedIdempotent: 0,
    entriesWritten: 0,
  };
  for (const [merchantAccountId, group] of grouped) {
    const plans = group.map(refundNettingToPlan);
    const result = await postPlans(
      client,
      organizationId,
      merchantAccountId,
      plans,
      actor,
      "ledger.refund_netting_posted",
    );
    totals.transactionsPosted += result.transactionsPosted;
    totals.transactionsSkippedIdempotent += result.transactionsSkippedIdempotent;
    totals.entriesWritten += result.entriesWritten;
  }
  return totals;
}

// Balance read: positive ₹ owed for liabilities, positive ₹ held for
// assets/expenses. Sign convention is per the plan: assets/expenses
// use +1 (debit - credit), liabilities/income/equity use -1
// (credit - debit). So merchant_payable reads as a positive ₹ owed.
export async function getBalance(
  client: PoolClient,
  organizationId: string,
  merchantAccountId: string,
  asOf: Date,
): Promise<BalanceRow[]> {
  const t0 = Date.now();
  const rows = await sumEntriesAsOf(
    client,
    organizationId,
    merchantAccountId,
    asOf,
  );
  const elapsed = Date.now() - t0;
  if (elapsed > 250) {
    // Per gaps.md / plan: warn before adding a snapshot table.
    console.warn(
      `[ledger.getBalance] slow query: ${elapsed}ms for merchant ${merchantAccountId} asOf=${asOf.toISOString()}`,
    );
  }
  return rows.map((row) => ({
    accountRole: row.accountRole,
    provider: row.provider,
    balance: applySign(row.accountType, row.debit, row.credit),
  }));
}

function applySign(
  type: "asset" | "liability" | "equity" | "income" | "expense",
  debit: number,
  credit: number,
): number {
  const raw =
    type === "asset" || type === "expense" ? debit - credit : credit - debit;
  return Math.round(raw * 100) / 100;
}

export async function listTransactions(
  client: PoolClient,
  organizationId: string,
  filters: {
    merchantAccountId: string;
    from: Date;
    to: Date;
    cursor?: string;
    limit?: number;
  },
): Promise<{
  transactions: LedgerTransaction[];
  nextCursor: string | null;
}> {
  const decodedCursor = decodeCursor(filters.cursor);
  const result = await listTransactionsForMerchant(client, organizationId, {
    merchantAccountId: filters.merchantAccountId,
    from: filters.from,
    to: filters.to,
    cursor: decodedCursor,
    limit: filters.limit ?? 50,
  });
  return {
    transactions: result.transactions,
    nextCursor: result.nextCursor ? encodeCursor(result.nextCursor) : null,
  };
}

function encodeCursor(cursor: { effectiveAt: string; id: string }): string {
  return Buffer.from(`${cursor.effectiveAt}|${cursor.id}`).toString("base64url");
}

function decodeCursor(
  encoded?: string,
): { effectiveAt: Date; id: string } | undefined {
  if (!encoded) return undefined;
  const decoded = Buffer.from(encoded, "base64url").toString("utf8");
  const [effectiveAt, id] = decoded.split("|");
  if (!effectiveAt || !id) {
    throw new DomainError("Invalid pagination cursor.", 400);
  }
  return { effectiveAt: new Date(effectiveAt), id };
}

export async function reverseTransaction(
  client: PoolClient,
  organizationId: string,
  transactionId: string,
  reason: string,
  actor: Actor,
): Promise<PostResult> {
  const original = await loadTransactionWithEntries(
    client,
    organizationId,
    transactionId,
  );
  if (!original) {
    throw new DomainError("Ledger transaction not found.", 404);
  }
  if (original.reversalOf) {
    throw new DomainError(
      "Cannot reverse a reversal entry. Reverse the original transaction instead.",
      409,
    );
  }
  const idempotencyKey = `reverse:${original.id}`;
  const existing = await findTransactionByIdempotencyKey(
    client,
    organizationId,
    idempotencyKey,
  );
  if (existing) {
    return {
      transactionsPosted: 0,
      transactionsSkippedIdempotent: 1,
      entriesWritten: 0,
    };
  }
  const { id: reversalId } = await insertLedgerTransaction(client, {
    organizationId,
    sourceType: original.sourceType,
    sourceId: original.sourceId,
    sourceBatchId: original.sourceBatchId,
    externalRefs: { ...original.externalRefs, reversalReason: reason },
    effectiveAt: new Date(),
    idempotencyKey,
    description: `Reversal of ${original.id}: ${reason}`,
    reversalOf: original.id,
  });
  const flipped = original.entries.map((entry) => ({
    accountId: entry.accountId,
    direction: entry.direction === "debit" ? ("credit" as const) : ("debit" as const),
    amount: entry.amount,
  }));
  const { inserted } = await insertLedgerEntries(
    client,
    organizationId,
    reversalId,
    flipped,
  );
  await recordAuditEvent(
    {
      organizationId,
      actorUserId: actor.id,
      actorName: actor.name,
      action: "ledger.transaction_reversed",
      entityType: "ledger_transaction",
      entityId: original.id,
      details: { reversalId, reason, entriesWritten: inserted },
    },
    client,
  );
  return {
    transactionsPosted: 1,
    transactionsSkippedIdempotent: 0,
    entriesWritten: inserted,
  };
}
