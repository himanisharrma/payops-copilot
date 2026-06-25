"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Download,
  FileCheck2,
  LockKeyhole,
  RotateCcw,
  Send,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { providerName } from "@/lib/provider-webhooks";
import type {
  AppRole,
} from "@/lib/access";
import type {
  ReconciliationCloseWorkspace,
} from "@/lib/types";

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

const date = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeZone: "Asia/Kolkata",
  }).format(new Date(`${value}T12:00:00+05:30`));

export function ReconciliationCloseControl({
  initialWorkspace,
  actor,
}: {
  initialWorkspace: ReconciliationCloseWorkspace;
  actor: { name: string; role: AppRole };
}) {
  const selected = initialWorkspace.selected;
  const [caseThreshold, setCaseThreshold] = useState(
    selected.unresolvedCountThreshold,
  );
  const [amountThreshold, setAmountThreshold] = useState(
    selected.unresolvedAmountThreshold,
  );
  const [dispositions, setDispositions] = useState<
    Record<string, { reason: string; evidenceConfirmed: boolean }>
  >(
    Object.fromEntries(
      selected.readiness.unresolvedCases.map((paymentCase) => {
        const existing = selected.activeVersion?.dispositions.find(
          (item) => item.caseId === paymentCase.id,
        );
        return [
          paymentCase.id,
          {
            reason: existing?.reason ?? "",
            evidenceConfirmed: existing?.evidenceConfirmed ?? false,
          },
        ];
      }),
    ),
  );
  const [reopenReason, setReopenReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const canEdit = actor.role !== "viewer";
  const isAdmin = actor.role === "admin";

  const blockers = useMemo(() => {
    const values: string[] = [];
    const readiness = selected.readiness;
    if (!readiness.runCount) {
      values.push("No completed reconciliation run exists for this scope.");
    }
    if (readiness.blockingCaseCount) {
      values.push(
        `${readiness.blockingCaseCount} high-priority exception${readiness.blockingCaseCount === 1 ? " remains" : "s remain"} unresolved.`,
      );
    }
    if (readiness.unresolvedCaseCount > caseThreshold) {
      values.push(`Case count exceeds the threshold of ${caseThreshold}.`);
    }
    if (readiness.unresolvedExposure > amountThreshold) {
      values.push(
        `Exposure exceeds the threshold of ${money.format(amountThreshold)}.`,
      );
    }
    return values;
  }, [amountThreshold, caseThreshold, selected.readiness]);

  const dispositionComplete = selected.readiness.unresolvedCases.every(
    (paymentCase) => {
      const item = dispositions[paymentCase.id];
      return (
        item?.evidenceConfirmed === true &&
        item.reason.trim().length >= 10
      );
    },
  );
  const ready = blockers.length === 0 && dispositionComplete;
  const ledgerState =
    selected.status === "approved"
      ? "Snapshot approved"
      : selected.status === "submitted"
        ? "Awaiting approval"
        : ready
          ? "Ready to submit"
          : "Control blocked";

  async function request(url: string, method: "POST" | "PATCH", body: unknown) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Request failed.");
      window.location.reload();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The close action failed.",
      );
      setBusy(false);
    }
  }

  function submitClose() {
    return request("/api/close-controls", "POST", {
      businessDate: selected.businessDate,
      providerId: selected.providerId,
      paymentMode: selected.paymentMode,
      unresolvedCountThreshold: caseThreshold,
      unresolvedAmountThreshold: amountThreshold,
      dispositions: selected.readiness.unresolvedCases.map((paymentCase) => ({
        caseId: paymentCase.id,
        ...dispositions[paymentCase.id],
      })),
    });
  }

  return (
    <>
      <section className="workspace-hero compact-hero close-control-hero">
        <div>
          <p className="kicker">
            <span>RECONCILIATION CLOSE CONTROL</span>
            <span>IST BUSINESS DATE</span>
          </p>
          <h1>End the day with a signed control—not an assumption.</h1>
          <p>
            Prove that the scoped payment book is reconciled, residual risk is
            dispositioned, and a different accountable person approved it.
          </p>
        </div>
        <div className={`close-seal ${selected.status}`}>
          {selected.status === "approved" ? (
            <ShieldCheck size={26} />
          ) : selected.status === "submitted" ? (
            <UserCheck size={26} />
          ) : (
            <FileCheck2 size={26} />
          )}
          <span>CONTROL STATE</span>
          <strong>{selected.status.replace("_", " ")}</strong>
          <small>
            {selected.activeVersion
              ? `Version ${selected.activeVersion.versionNumber}`
              : "No submitted snapshot"}
          </small>
        </div>
      </section>

      <div className="close-control-page">
        <form className="close-scope-bar" method="GET">
          <label>
            <span>Business date</span>
            <select name="date" defaultValue={selected.businessDate}>
              {initialWorkspace.options.businessDates.map((value) => (
                <option key={value} value={value}>
                  {date(value)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Provider</span>
            <select name="provider" defaultValue={selected.providerId}>
              {initialWorkspace.options.providers.map((value) => (
                <option key={value} value={value}>
                  {providerName(value)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Payment mode</span>
            <select name="paymentMode" defaultValue={selected.paymentMode}>
              {initialWorkspace.options.paymentModes.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Load control book</button>
        </form>

        <section className="close-ledger" aria-label="Close readiness ledger">
          <header>
            <div>
              <span>DAILY CONTROL BOOK</span>
              <h2>
                {date(selected.businessDate)} ·{" "}
                {providerName(selected.providerId)} · {selected.paymentMode}
              </h2>
            </div>
            <strong
              className={
                selected.status === "approved" || ready
                  ? "ready"
                  : selected.status === "submitted"
                    ? "pending"
                    : "blocked"
              }
            >
              {selected.status === "approved" || ready ? (
                <Check size={15} />
              ) : selected.status === "submitted" ? (
                <UserCheck size={15} />
              ) : (
                <AlertTriangle size={15} />
              )}
              {ledgerState}
            </strong>
          </header>
          <div className="close-metrics">
            <article>
              <span>RUNS / ITEMS</span>
              <strong>
                {selected.readiness.runCount} / {selected.readiness.itemCount}
              </strong>
              <small>Completed scope evidence</small>
            </article>
            <article>
              <span>PROCESSED</span>
              <strong>{money.format(selected.readiness.processedValue)}</strong>
              <small>{money.format(selected.readiness.matchedValue)} matched</small>
            </article>
            <article>
              <span>OPEN EXCEPTIONS</span>
              <strong>{selected.readiness.unresolvedCaseCount}</strong>
              <small>
                {selected.readiness.blockingCaseCount} high-priority blockers
              </small>
            </article>
            <article>
              <span>RESIDUAL EXPOSURE</span>
              <strong>
                {money.format(selected.readiness.unresolvedExposure)}
              </strong>
              <small>Deterministic persisted values</small>
            </article>
            <article>
              <span>SETTLEMENT PAYABLE</span>
              <strong>
                {money.format(selected.readiness.settlementPayable)}
              </strong>
              <small>
                {money.format(selected.readiness.settlementCredited)} credited
              </small>
            </article>
            <article>
              <span>OUTSTANDING PAYABLE</span>
              <strong>
                {money.format(selected.readiness.settlementOutstanding)}
              </strong>
              <small>
                {money.format(
                  selected.readiness.settlementHeldAmount +
                    selected.readiness.settlementFailedAmount,
                )}{" "}
                held / failed
              </small>
            </article>
          </div>

          <div className="close-thresholds">
            <div>
              <span>MATERIALITY POLICY</span>
              <p>
                High-priority exceptions always block. Lower-priority residuals
                require evidence-confirmed disposition and must stay within both
                thresholds.
              </p>
            </div>
            <label>
              <span>Maximum open cases</span>
              <input
                type="number"
                min="0"
                max="10000"
                value={caseThreshold}
                disabled={!canEdit || selected.status === "submitted" || selected.status === "approved"}
                onChange={(event) =>
                  setCaseThreshold(Number(event.target.value))
                }
              />
            </label>
            <label>
              <span>Maximum exposure (₹)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={amountThreshold}
                disabled={!canEdit || selected.status === "submitted" || selected.status === "approved"}
                onChange={(event) =>
                  setAmountThreshold(Number(event.target.value))
                }
              />
            </label>
          </div>

          {blockers.length > 0 && (
            <div className="close-blockers">
              <AlertTriangle size={18} />
              <div>
                <strong>Resolve these controls before submission</strong>
                <ul>
                  {blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>

        <section className="close-residual-panel">
          <header>
            <div>
              <span>RESIDUAL RISK REGISTER</span>
              <h2>Disposition every unresolved exception</h2>
            </div>
            <strong>
              {selected.readiness.unresolvedCases.length} records
            </strong>
          </header>
          {selected.readiness.unresolvedCases.length ? (
            <div className="close-residual-list">
              {selected.readiness.unresolvedCases.map((paymentCase, index) => (
                <article key={paymentCase.id}>
                  <div className="close-case-index">
                    {String(index + 1).padStart(2, "0")}
                  </div>
                  <div className="close-case-facts">
                    <strong>{paymentCase.orderId}</strong>
                    <span>
                      {paymentCase.reconciliationStatus.replaceAll("_", " ")}
                    </span>
                    <small>
                      {paymentCase.priority} ·{" "}
                      {money.format(paymentCase.exposure)} ·{" "}
                      {paymentCase.owner ?? "unassigned"}
                    </small>
                  </div>
                  <label className="close-disposition">
                    <span>Accepted-risk rationale</span>
                    <textarea
                      value={dispositions[paymentCase.id]?.reason ?? ""}
                      disabled={!canEdit || selected.status === "submitted" || selected.status === "approved"}
                      placeholder="Explain why this residual can remain open at close…"
                      onChange={(event) =>
                        setDispositions((current) => ({
                          ...current,
                          [paymentCase.id]: {
                            ...current[paymentCase.id],
                            reason: event.target.value,
                          },
                        }))
                      }
                    />
                  </label>
                  <label className="close-confirmation">
                    <input
                      type="checkbox"
                      checked={
                        dispositions[paymentCase.id]?.evidenceConfirmed ??
                        false
                      }
                      disabled={!canEdit || selected.status === "submitted" || selected.status === "approved"}
                      onChange={(event) =>
                        setDispositions((current) => ({
                          ...current,
                          [paymentCase.id]: {
                            ...current[paymentCase.id],
                            evidenceConfirmed: event.target.checked,
                          },
                        }))
                      }
                    />
                    <span>I reviewed the persisted source evidence.</span>
                  </label>
                </article>
              ))}
            </div>
          ) : (
            <div className="close-empty">
              <Check size={20} />
              No unresolved exceptions remain in this scope.
            </div>
          )}
        </section>

        <section className="close-approval-chain">
          <div className="close-chain-node">
            <span>01 · MAKER</span>
            <strong>
              {selected.activeVersion?.preparedByName ?? actor.name}
            </strong>
            <small>
              {selected.activeVersion
                ? `Submitted ${new Date(selected.activeVersion.preparedAt).toLocaleString("en-IN")}`
                : "Analyst or administrator prepares evidence"}
            </small>
          </div>
          <ArrowRight size={22} />
          <div className="close-chain-lock">
            <LockKeyhole size={23} />
            <span>Different user required</span>
          </div>
          <ArrowRight size={22} />
          <div className="close-chain-node">
            <span>02 · CHECKER</span>
            <strong>
              {selected.activeVersion?.approvedByName ?? "Administrator"}
            </strong>
            <small>
              {selected.activeVersion?.approvedAt
                ? `Approved ${new Date(selected.activeVersion.approvedAt).toLocaleString("en-IN")}`
                : "Reviews the immutable submitted snapshot"}
            </small>
          </div>
        </section>

        {message && <p className="close-message">{message}</p>}

        <section className="close-action-bar">
          <div>
            <span>NEXT CONTROL ACTION</span>
            <strong>
              {selected.status === "submitted"
                ? "Independent approval required"
                : selected.status === "approved"
                  ? "Close certificate locked"
                  : "Prepare and submit the control snapshot"}
            </strong>
          </div>
          <div className="close-actions">
            {(selected.status === "open" || selected.status === "reopened") &&
              canEdit && (
                <button
                  disabled={!ready || busy}
                  onClick={submitClose}
                >
                  <Send size={15} />
                  Submit for approval
                </button>
              )}
            {selected.status === "submitted" && isAdmin && selected.id && (
              <button
                disabled={busy}
                onClick={() =>
                  request(
                    `/api/close-controls/${selected.id}`,
                    "PATCH",
                    { action: "approve" },
                  )
                }
              >
                <UserCheck size={15} />
                Approve close
              </button>
            )}
            {(selected.status === "approved" ||
              (selected.status === "reopened" &&
                selected.activeVersion?.approvedAt)) &&
              selected.id && (
              <a
                href={`/api/close-controls/${selected.id}/certificate`}
                className="close-download"
              >
                <Download size={15} />
                Download certificate
              </a>
            )}
          </div>
        </section>

        {selected.status === "approved" && isAdmin && selected.id && (
          <section className="close-reopen-control">
            <div>
              <RotateCcw size={18} />
              <div>
                <strong>Controlled reopen</strong>
                <p>
                  The approved version remains immutable. Reopening permits a
                  new submitted version and requires an audit reason.
                </p>
              </div>
            </div>
            <textarea
              value={reopenReason}
              placeholder="Why must this approved period be reopened?"
              onChange={(event) => setReopenReason(event.target.value)}
            />
            <button
              disabled={reopenReason.trim().length < 10 || busy}
              onClick={() =>
                request(`/api/close-controls/${selected.id}`, "PATCH", {
                  action: "reopen",
                  reason: reopenReason,
                })
              }
            >
              Reopen period
            </button>
          </section>
        )}

        <section className="close-history">
          <header>
            <div>
              <span>CLOSE HISTORY</span>
              <h2>Prior control decisions</h2>
            </div>
            <FileCheck2 size={20} />
          </header>
          <div className="close-history-head">
            <span>Period</span>
            <span>Scope</span>
            <span>Version</span>
            <span>Maker / checker</span>
            <span>State</span>
          </div>
          {initialWorkspace.history.length ? (
            initialWorkspace.history.map((period) => (
              <a
                key={period.id}
                href={`/close-control?date=${period.businessDate}&provider=${period.providerId}&paymentMode=${encodeURIComponent(period.paymentMode)}`}
              >
                <strong>{date(period.businessDate)}</strong>
                <span>
                  {providerName(period.providerId)} · {period.paymentMode}
                </span>
                <span>
                  {period.activeVersion
                    ? `v${period.activeVersion.versionNumber}`
                    : "—"}
                </span>
                <span>
                  {period.activeVersion?.preparedByName ?? "—"}
                  <small>
                    {period.activeVersion?.approvedByName
                      ? ` → ${period.activeVersion.approvedByName}`
                      : " → pending"}
                  </small>
                </span>
                <em className={period.status}>{period.status}</em>
              </a>
            ))
          ) : (
            <div className="close-empty">
              Close history appears after the first submission.
            </div>
          )}
        </section>

        <p className="close-boundary">
          Synthetic portfolio control only. A PayOps close certificate is an
          internal evidence snapshot, not a bank statement, provider
          attestation, or instruction to move money.
        </p>
      </div>
    </>
  );
}
