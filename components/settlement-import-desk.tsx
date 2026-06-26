"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileDown,
  FileUp,
  GitCompareArrows,
  ShieldCheck,
} from "lucide-react";
import type { AppRole } from "@/lib/access";
import type {
  SettlementImportDetail,
  SettlementImportException,
  SettlementImportWorkspace,
} from "@/lib/modules/settlement-imports/types";

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

const exceptionLabels: Record<string, string> = {
  missing_utr: "Missing UTR",
  utr_not_found: "UTR not found",
  duplicate_utr: "Duplicate UTR",
  amount_mismatch: "Amount mismatch",
  failed_payout: "Failed payout",
  held_settlement: "Held settlement",
  delayed_credit: "Delayed credit",
  retry_exhausted: "Retry exhausted",
  deduction_mismatch: "Deduction mismatch",
  unexplained_hold: "Unexplained hold",
  forward_deduction_mismatch: "Forward deduction mismatch",
};

const sampleCsv = `statement_reference,merchant_reference,order_id,gateway_reference,payment_mode,gross_amount,deduction_amount,deduction_type,utr,bank_reference,settlement_status,expected_settlement_at,actual_settlement_at
STMT-DEMO-UPLOAD-001,synthetic-demo-merchant,ORD-DEMO-001,PAY-DEMO-001,UPI,1200,24,mdr,UTR-DEMO-001,BNK-DEMO-001,credited,2026-06-24T10:00:00+05:30,2026-06-24T12:00:00+05:30
STMT-DEMO-UPLOAD-002,synthetic-demo-merchant,ORD-DEMO-002,PAY-DEMO-002,CARD,900,18,mdr,,BNK-DEMO-002,credited,2026-06-24T10:00:00+05:30,2026-06-24T12:00:00+05:30`;

export function SettlementImportDesk({
  actorRole,
  workspace,
  selected,
}: {
  actorRole: AppRole;
  workspace: SettlementImportWorkspace;
  selected: SettlementImportDetail | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [providerId, setProviderId] = useState("generic");
  const canEdit = actorRole !== "viewer";

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams();
    const next = { ...workspace.filters, [key]: value };
    for (const [filterKey, filterValue] of Object.entries(next)) {
      if (filterValue !== "all") params.set(filterKey, filterValue);
    }
    router.push(`/settlement-imports${params.size ? `?${params}` : ""}`);
  }

  async function uploadImport(formData: FormData) {
    setBusy(true);
    setMessage(null);
    formData.set("providerId", providerId);
    try {
      const response = await fetch("/api/settlement-imports", {
        method: "POST",
        body: formData,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Import failed.");
      router.push(`/settlement-imports?importId=${result.importBatchId}`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  async function recompare() {
    if (!selected) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/settlement-imports/${selected.id}/recompare`, {
        method: "POST",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Recompare failed.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Recompare failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="workspace-hero compact-hero import-desk-hero">
        <div>
          <p className="kicker">
            <span>STATEMENT IMPORT</span>
            <span>SETTLEMENT EXCEPTION DESK</span>
          </p>
          <h1>Stage provider statements before they become truth.</h1>
          <p>
            Upload synthetic provider-style settlement CSVs, compare them to
            PayOps settlement evidence, and govern adjustments without changing
            the ledger or moving money.
          </p>
        </div>
        <aside className="demo-control-brief">
          <ShieldCheck size={26} />
          <span>Synthetic-only import</span>
          <strong>No provider API. No bank action. No payout instruction.</strong>
          <p>Imported rows are staged evidence, not settlement truth.</p>
        </aside>
      </section>

      <section className="import-desk-ledger" aria-label="Import summary">
        <article><span>Imports</span><strong>{workspace.summary.imports}</strong></article>
        <article><span>Rows staged</span><strong>{workspace.summary.importedRows}</strong></article>
        <article><span>Open exceptions</span><strong>{workspace.summary.openExceptions}</strong></article>
        <article><span>Exposure</span><strong>{money.format(workspace.summary.exposureAmount)}</strong></article>
        <article><span>Proposed adjustments</span><strong>{workspace.summary.proposedAdjustments}</strong></article>
      </section>

      <section className="import-desk-grid">
        <aside className="import-uploader">
          <header>
            <FileUp size={21} />
            <div>
              <span>UPLOAD</span>
              <h2>Import a statement CSV</h2>
            </div>
          </header>
          <p>
            Use provider-style columns such as statement_reference, order_id,
            gateway_reference, gross_amount, deduction_amount, utr, and
            settlement_status.
          </p>
          {canEdit ? (
            <form action={uploadImport}>
              <label>
                Provider
                <select value={providerId} onChange={(event) => setProviderId(event.target.value)}>
                  <option value="generic">Generic CSV</option>
                  <option value="razorpay_demo">Razorpay Demo</option>
                  <option value="cashfree_demo">Cashfree Demo</option>
                  <option value="payu_demo">PayU Demo</option>
                </select>
              </label>
              <label>
                CSV file
                <input name="file" type="file" accept=".csv,text/csv" required />
              </label>
              <button disabled={busy} type="submit">Upload and compare</button>
            </form>
          ) : (
            <p className="readonly-note">Viewer access is read-only.</p>
          )}
          <details>
            <summary>Demo CSV sample</summary>
            <pre>{sampleCsv}</pre>
          </details>
          {message && <p className="form-message">{message}</p>}
        </aside>

        <section className="import-history">
          <header>
            <div>
              <span>IMPORT HISTORY</span>
              <h2>Staged statement files</h2>
            </div>
            <GitCompareArrows size={20} />
          </header>
          <div className="import-filter-row">
            <select value={workspace.filters.provider} onChange={(event) => setFilter("provider", event.target.value)}>
              <option value="all">All providers</option>
              <option value="generic">Generic CSV</option>
              <option value="razorpay_demo">Razorpay Demo</option>
              <option value="cashfree_demo">Cashfree Demo</option>
              <option value="payu_demo">PayU Demo</option>
            </select>
            <select value={workspace.filters.exceptionType} onChange={(event) => setFilter("exceptionType", event.target.value)}>
              <option value="all">All exceptions</option>
              {Object.entries(exceptionLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <select value={workspace.filters.adjustmentState} onChange={(event) => setFilter("adjustmentState", event.target.value)}>
              <option value="all">All adjustments</option>
              <option value="none">No adjustment</option>
              <option value="proposed">Proposed</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div className="import-list">
            {workspace.imports.map((item) => (
              <Link key={item.id} href={`/settlement-imports?importId=${item.id}`}>
                <strong>{item.importReference}</strong>
                <span>{item.providerId} · {item.rowCount} rows · {item.exceptionCount} exceptions</span>
                <small>{item.status} · imported by {item.importedByName}</small>
                <ArrowRight size={15} />
              </Link>
            ))}
          </div>
        </section>
      </section>

      {selected ? (
        <section className="import-detail">
          <header>
            <div>
              <span>SELECTED IMPORT</span>
              <h2>{selected.importReference}</h2>
            </div>
            <div className="import-actions">
              {canEdit && <button disabled={busy} onClick={recompare}>Recompare</button>}
              <a href={`/api/settlement-imports/${selected.id}/evidence-packet`}>
                <FileDown size={15} /> Export evidence packet
              </a>
            </div>
          </header>
          <div className="staged-row-table">
            <div className="staged-row-head">
              <span>Row</span><span>Statement</span><span>Order</span><span>Net</span><span>UTR</span><span>Status</span>
            </div>
            {selected.rows.slice(0, 12).map((row) => (
              <div key={row.rowFingerprint}>
                <span>{row.rowNumber}</span>
                <span>{row.statementReference}</span>
                <span>{row.orderId}</span>
                <span>{money.format(row.netAmount)}</span>
                <span>{row.utr ?? "—"}</span>
                <span>{row.settlementStatus}</span>
              </div>
            ))}
          </div>
          <ExceptionDesk exceptions={selected.exceptions} canEdit={canEdit} />
        </section>
      ) : (
        <section className="import-empty">
          <CheckCircle2 size={22} />
          <h2>No statement imports yet.</h2>
          <p>Seed demo data or upload a synthetic CSV to populate the desk.</p>
        </section>
      )}
    </>
  );
}

function ExceptionDesk({
  exceptions,
  canEdit,
}: {
  exceptions: SettlementImportException[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<SettlementImportException | null>(
    exceptions[0] ?? null,
  );
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  async function propose(exception: SettlementImportException) {
    setBusy(true);
    try {
      await fetch("/api/settlement-adjustments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          exceptionId: exception.id,
          adjustmentType: "manual_review",
          amount: Number(amount || exception.exposureAmount),
          reason,
          evidenceReference: `exception:${exception.id}`,
        }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="exception-desk">
      <header>
        <div>
          <span>SETTLEMENT EXCEPTION DESK</span>
          <h2>{exceptions.length} imported statement exceptions</h2>
        </div>
        <AlertTriangle size={20} />
      </header>
      <div className="exception-desk-layout">
        <div className="exception-list">
          {exceptions.map((exception) => (
            <button key={exception.id} onClick={() => setSelected(exception)}>
              <strong>{exceptionLabels[exception.exceptionType]}</strong>
              <span>{money.format(exception.exposureAmount)} · {exception.priority}</span>
              <small>{exception.adjustment?.status ?? "no adjustment"}</small>
            </button>
          ))}
        </div>
        {selected && (
          <aside className="adjustment-drawer">
            <span>{selected.status}</span>
            <h3>{exceptionLabels[selected.exceptionType]}</h3>
            <p>{selected.summary}</p>
            {selected.operationsCaseId && (
              <Link href={`/operations?caseId=${selected.operationsCaseId}`}>
                Open linked Operations case
              </Link>
            )}
            {selected.adjustment ? (
              <div className="adjustment-state">
                <strong>{selected.adjustment.status}</strong>
                <p>{selected.adjustment.reason}</p>
              </div>
            ) : canEdit ? (
              <div className="adjustment-form">
                <input
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder={String(selected.exposureAmount)}
                  type="number"
                />
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Why is this adjustment proposed?"
                />
                <button disabled={busy || reason.length < 10} onClick={() => propose(selected)}>
                  Propose adjustment
                </button>
              </div>
            ) : (
              <p className="readonly-note">Viewer access is read-only.</p>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
