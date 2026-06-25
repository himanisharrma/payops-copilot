"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BadgeIndianRupee,
  Banknote,
  FileCheck2,
  Landmark,
  Link2,
  ReceiptText,
  ShieldCheck,
} from "lucide-react";

export type MerchantSettlementStatus =
  | "expected"
  | "scheduled"
  | "sent"
  | "credited"
  | "held"
  | "failed"
  | "partially_credited";

export type MerchantSettlementUtrState =
  | "matched"
  | "missing_utr"
  | "utr_not_found"
  | "duplicate_utr"
  | "amount_mismatch"
  | "failed_payout"
  | "held_settlement"
  | "delayed_credit"
  | "retry_exhausted"
  | "awaiting_credit"
  | "not_due";

export type MerchantSettlementFilters = {
  range: "7d" | "30d" | "90d";
  date: string;
  merchant: string;
  provider: string;
  status: string;
  utrState: string;
  statementId: string;
};

export type MerchantSettlementDeduction = {
  label: string;
  amount: number;
  evidence: string;
  kind:
    | "mdr"
    | "commission"
    | "gst"
    | "refund"
    | "chargeback"
    | "recovery"
    | "adjustment"
    | "rental"
    | "subscription"
    | "hold"
    | "hold_release"
    | "rounding";
};

export type MerchantSettlementStatement = {
  id: string;
  merchantName: string;
  merchantCode: string;
  provider: string;
  providerLabel: string;
  batchId: string;
  periodLabel: string;
  statementDate: string;
  expectedSettlementDate: string;
  actualSettlementDate: string | null;
  status: MerchantSettlementStatus;
  utrState: MerchantSettlementUtrState;
  utr: string | null;
  bankCreditRef: string | null;
  bankCreditMatchedAt: string | null;
  grossAmount: number;
  deductionsTotal: number;
  netSettlement: number;
  lineItemCount: number;
  linkedCaseIds: string[];
  deductions: MerchantSettlementDeduction[];
  evidence: {
    source: string;
    hash: string;
    note: string;
  }[];
};

export type MerchantSettlementWorkspace = {
  filters: MerchantSettlementFilters;
  statements: MerchantSettlementStatement[];
  options: {
    merchants: string[];
    providers: { value: string; label: string }[];
  };
};

const statusLabels: Record<MerchantSettlementStatus, string> = {
  expected: "Expected",
  scheduled: "Scheduled",
  sent: "Sent",
  credited: "Credited",
  held: "Held",
  failed: "Failed",
  partially_credited: "Partially credited",
};

const utrLabels: Record<MerchantSettlementUtrState, string> = {
  matched: "UTR matched",
  missing_utr: "Missing UTR",
  utr_not_found: "UTR not found",
  duplicate_utr: "Duplicate UTR",
  amount_mismatch: "Amount mismatch",
  failed_payout: "Failed payout",
  held_settlement: "Held settlement",
  delayed_credit: "Delayed credit",
  retry_exhausted: "Retry exhausted",
  awaiting_credit: "Awaiting credit",
  not_due: "Not due",
};

const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);

const shortDate = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(`${value}T00:00:00+05:30`));

function buildParams(
  current: MerchantSettlementFilters,
  patch: Partial<MerchantSettlementFilters>,
) {
  const next = { ...current, ...patch };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(next)) {
    if (!value) continue;
    if (key === "range" && value === "30d") continue;
    if (key === "merchant" && value === "all") continue;
    if (key === "provider" && value === "all") continue;
    if (key === "status" && value === "all") continue;
    if (key === "utrState" && value === "all") continue;
    params.set(key, value);
  }
  return `/settlements${params.size ? `?${params}` : ""}`;
}

function summarize(items: MerchantSettlementStatement[]) {
  return items.reduce(
    (acc, item) => ({
      gross: acc.gross + item.grossAmount,
      deductions: acc.deductions + item.deductionsTotal,
      net: acc.net + item.netSettlement,
      outstanding:
        acc.outstanding +
        (item.status === "credited" ? 0 : item.netSettlement),
      exceptions:
        acc.exceptions +
        (["matched", "not_due", "awaiting_credit"].includes(item.utrState) &&
        item.status !== "failed"
          ? 0
          : 1),
    }),
    { gross: 0, deductions: 0, net: 0, outstanding: 0, exceptions: 0 },
  );
}

export function MerchantSettlementStatements({
  workspace,
}: {
  workspace: MerchantSettlementWorkspace;
}) {
  const router = useRouter();
  const filtered = workspace.statements.filter((item) => {
    if (
      workspace.filters.merchant !== "all" &&
      item.merchantName !== workspace.filters.merchant
    ) {
      return false;
    }
    if (
      workspace.filters.provider !== "all" &&
      item.provider !== workspace.filters.provider
    ) {
      return false;
    }
    if (
      workspace.filters.status !== "all" &&
      item.status !== workspace.filters.status
    ) {
      return false;
    }
    if (
      workspace.filters.utrState !== "all" &&
      item.utrState !== workspace.filters.utrState
    ) {
      return false;
    }
    if (
      workspace.filters.date &&
      item.statementDate !== workspace.filters.date
    ) {
      return false;
    }
    return true;
  });
  const selected =
    filtered.find((item) => item.id === workspace.filters.statementId) ??
    filtered[0] ??
    workspace.statements[0];
  const kpis = summarize(filtered);

  function setFilter(patch: Partial<MerchantSettlementFilters>) {
    router.replace(
      buildParams(workspace.filters, { statementId: "", ...patch }),
      { scroll: false },
    );
  }

  return (
    <>
      <section className="workspace-hero compact-hero settlement-statements-hero">
        <div>
          <p className="kicker">
            <span>MERCHANT SETTLEMENT STATEMENTS</span>
            <span>READ-ONLY LEDGER</span>
          </p>
          <h1>Trace every rupee from collection to bank credit.</h1>
          <p>
            Review gross collections, deterministic deductions, net settlement,
            UTR evidence, bank credit matching, and linked Operations cases for
            synthetic merchant payout batches.
          </p>
        </div>
        <aside
          className="settlement-boundary-card"
          aria-label="Synthetic data boundary"
        >
          <ShieldCheck size={28} />
          <span>Synthetic boundary</span>
          <strong>No live providers. No money movement.</strong>
          <p>
            This read-only surface uses fictional settlement evidence and must
            not be presented as provider-side or bank-side truth.
          </p>
        </aside>
      </section>

      <section
        className="settlement-statements-filter-rail"
        aria-label="Settlement statement filters"
      >
        <label>
          RANGE
          <select
            value={workspace.filters.range}
            onChange={(event) =>
              setFilter({ range: event.target.value as MerchantSettlementFilters["range"] })
            }
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
        </label>
        <label>
          DATE
          <input
            type="date"
            value={workspace.filters.date}
            onChange={(event) => setFilter({ date: event.target.value })}
          />
        </label>
        <label>
          MERCHANT
          <select
            value={workspace.filters.merchant}
            onChange={(event) => setFilter({ merchant: event.target.value })}
          >
            <option value="all">All merchants</option>
            {workspace.options.merchants.map((merchant) => (
              <option key={merchant} value={merchant}>
                {merchant}
              </option>
            ))}
          </select>
        </label>
        <label>
          PROVIDER
          <select
            value={workspace.filters.provider}
            onChange={(event) => setFilter({ provider: event.target.value })}
          >
            <option value="all">All providers</option>
            {workspace.options.providers.map((provider) => (
              <option key={provider.value} value={provider.value}>
                {provider.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          STATUS
          <select
            value={workspace.filters.status}
            onChange={(event) => setFilter({ status: event.target.value })}
          >
            <option value="all">All statuses</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          UTR STATE
          <select
            value={workspace.filters.utrState}
            onChange={(event) => setFilter({ utrState: event.target.value })}
          >
            <option value="all">All UTR states</option>
            {Object.entries(utrLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="settlement-statements-page">
        <section className="settlement-statements-kpis" aria-label="Ledger KPIs">
          <article>
            <span>Gross collected</span>
            <strong>{money(kpis.gross)}</strong>
            <small>{filtered.length} statement batches in view</small>
          </article>
          <article>
            <span>Deductions</span>
            <strong>{money(kpis.deductions)}</strong>
            <small>MDR, GST, refunds, chargebacks, holds</small>
          </article>
          <article>
            <span>Net settlement</span>
            <strong>{money(kpis.net)}</strong>
            <small>Merchant payable after deductions</small>
          </article>
          <article>
            <span>Outstanding payable</span>
            <strong>{money(kpis.outstanding)}</strong>
            <small>{kpis.exceptions} batch(es) need evidence review</small>
          </article>
        </section>

        <div className="settlement-statements-layout">
          <section
            className="settlement-statement-list"
            aria-label="Statement list"
          >
            <div className="settlement-table-head" aria-hidden="true">
              <span>Statement</span>
              <span>Gross</span>
              <span>Deductions</span>
              <span>Net</span>
              <span>UTR</span>
            </div>
            {filtered.length ? (
              filtered.map((item) => (
                <Link
                  key={item.id}
                  className={`settlement-table-row ${
                    selected?.id === item.id ? "active" : ""
                  }`}
                  href={buildParams(workspace.filters, {
                    statementId: item.id,
                  })}
                  scroll={false}
                >
                  <span>
                    <strong>{item.merchantName}</strong>
                    <small>
                      {item.batchId} · {shortDate(item.statementDate)}
                    </small>
                  </span>
                  <span>{money(item.grossAmount)}</span>
                  <span>{money(item.deductionsTotal)}</span>
                  <span>{money(item.netSettlement)}</span>
                  <span className={`utr-chip ${item.utrState}`}>
                    {utrLabels[item.utrState]}
                  </span>
                </Link>
              ))
            ) : (
              <div className="settlement-empty-state">
                <ReceiptText size={26} />
                <h2>No statement matches these filters.</h2>
                <p>
                  Clear the date or widen the range to inspect the synthetic
                  settlement ledger.
                </p>
              </div>
            )}
          </section>

          {selected && (
            <aside className="settlement-detail-panel">
              <header>
                <span>{selected.batchId}</span>
                <h2>{selected.merchantName}</h2>
                <p>
                  {selected.periodLabel} · {selected.providerLabel} ·{" "}
                  {selected.lineItemCount} transactions
                </p>
              </header>

              <div className="settlement-detail-ledger">
                <div>
                  <span>Status</span>
                  <strong>{statusLabels[selected.status]}</strong>
                </div>
                <div>
                  <span>Expected</span>
                  <strong>{shortDate(selected.expectedSettlementDate)}</strong>
                </div>
                <div>
                  <span>Actual</span>
                  <strong>
                    {selected.actualSettlementDate
                      ? shortDate(selected.actualSettlementDate)
                      : "Pending"}
                  </strong>
                </div>
                <div>
                  <span>Net</span>
                  <strong>{money(selected.netSettlement)}</strong>
                </div>
              </div>

              <section className="deduction-waterfall">
                <div>
                  <span>Deduction waterfall</span>
                  <strong>{money(selected.grossAmount)}</strong>
                  <small>Gross collected</small>
                </div>
                {selected.deductions.map((deduction) => (
                  <div key={`${selected.id}-${deduction.label}`}>
                    <span>{deduction.label}</span>
                    <strong>-{money(deduction.amount)}</strong>
                    <small>{deduction.evidence}</small>
                  </div>
                ))}
                <div className="net">
                  <span>Net payable</span>
                  <strong>{money(selected.netSettlement)}</strong>
                  <small>Deterministic arithmetic only</small>
                </div>
              </section>

              <section className="bank-evidence-card">
                <header>
                  <Landmark size={18} />
                  <div>
                    <span>UTR / bank credit evidence</span>
                    <h3>{utrLabels[selected.utrState]}</h3>
                  </div>
                </header>
                <dl>
                  <div>
                    <dt>UTR</dt>
                    <dd>{selected.utr ?? "Not supplied"}</dd>
                  </div>
                  <div>
                    <dt>Bank credit reference</dt>
                    <dd>{selected.bankCreditRef ?? "No bank match yet"}</dd>
                  </div>
                  <div>
                    <dt>Matched at</dt>
                    <dd>
                      {selected.bankCreditMatchedAt
                        ? shortDate(selected.bankCreditMatchedAt)
                        : "Pending verification"}
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="statement-evidence-list">
                <span>Source evidence</span>
                {selected.evidence.map((item) => (
                  <article key={`${selected.id}-${item.hash}`}>
                    <FileCheck2 size={15} />
                    <div>
                      <strong>{item.source}</strong>
                      <p>{item.note}</p>
                      <small>{item.hash}</small>
                    </div>
                  </article>
                ))}
              </section>

              <section className="linked-case-panel">
                <div>
                  <Link2 size={16} />
                  <span>Linked Operations cases</span>
                </div>
                {selected.linkedCaseIds.length ? (
                  selected.linkedCaseIds.map((caseId) => (
                    <Link
                      key={caseId}
                      href={`/operations?caseId=${encodeURIComponent(caseId)}`}
                    >
                      {caseId}
                      <ArrowRight size={14} />
                    </Link>
                  ))
                ) : (
                  <p>No linked case for this synthetic batch.</p>
                )}
              </section>
            </aside>
          )}
        </div>

        <section className="settlement-proof-strip">
          <article>
            <BadgeIndianRupee size={19} />
            <span>Statement truth</span>
            <strong>Computed from ledger inputs, not AI output.</strong>
          </article>
          <article>
            <Banknote size={19} />
            <span>Bank evidence</span>
            <strong>Only hash-backed fictional reports are shown.</strong>
          </article>
          <article>
            <ReceiptText size={19} />
            <span>Reviewer mode</span>
            <strong>All roles can inspect; no role can mutate here.</strong>
          </article>
        </section>
      </section>
    </>
  );
}
