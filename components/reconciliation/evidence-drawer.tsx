"use client";

import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Clock3,
  Sparkles,
  X,
} from "lucide-react";
import { SourceEvidenceLedger } from "@/components/ui/source-evidence-ledger";
import type {
  ReconciliationItem,
  ReconciliationStatus,
  SettlementTimingStatus,
} from "@/lib/types";

const statusLabels: Record<ReconciliationStatus, string> = {
  matched: "Matched",
  amount_mismatch: "Amount mismatch",
  missing_settlement: "Missing settlement",
  gateway_missing: "Gateway missing",
  duplicate: "Duplicate capture",
  pending: "Pending",
};

const settlementLabels: Record<SettlementTimingStatus, string> = {
  not_due: "Within cycle",
  due_today: "Due today",
  overdue: "Overdue",
  settled: "Settled",
  timing_unavailable: "Timing unavailable",
};

function formatTimestamp(value: string | null) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

function reconciliationLabel(selected: ReconciliationItem) {
  if (selected.status !== "missing_settlement") {
    return statusLabels[selected.status];
  }
  if (selected.settlementStatus === "overdue") return "Settlement overdue";
  if (selected.settlementStatus === "timing_unavailable") {
    return "Settlement timing unavailable";
  }
  return "Settlement monitored";
}

function suggestedNextStep(selected: ReconciliationItem) {
  if (selected.status === "matched") {
    return "No action needed. Keep this transaction in the audit record.";
  }
  if (selected.status === "pending") {
    return "Wait for the gateway status to become final, then run reconciliation again.";
  }
  if (selected.status === "missing_settlement") {
    if (selected.settlementStatus === "overdue") {
      return "This settlement is past its calculated deadline. Review the persisted source evidence before escalating.";
    }
    if (selected.settlementStatus === "timing_unavailable") {
      return "No deadline was calculated because a usable source timestamp was not supplied. Correct the source data and reconcile again.";
    }
    return "No action is required yet. Monitor this payment until the calculated settlement deadline passes.";
  }
  return "Confirm the source row with the payment provider before changing any financial record.";
}

export function ReconciliationEvidenceDrawer({
  selected,
  onClose,
  formatMoney,
}: {
  selected: ReconciliationItem;
  onClose: () => void;
  formatMoney: (value: number) => string;
}) {
  return (
    <div
      className="drawer-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <aside
        className="evidence-drawer"
        aria-label={`Evidence for ${selected.orderId}`}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="drawer-close"
          onClick={onClose}
          aria-label="Close evidence"
        >
          <X size={19} />
        </button>
        <p className="eyebrow">RECONCILIATION EVIDENCE</p>
        <div
          className={`drawer-icon ${selected.status} settlement-${selected.settlementStatus}`}
        >
          {selected.status === "matched" ? (
            <BadgeCheck size={28} />
          ) : selected.status === "pending" ? (
            <Clock3 size={28} />
          ) : (
            <AlertTriangle size={28} />
          )}
        </div>
        <h2>{selected.orderId}</h2>
        <span
          className={`status-pill ${selected.status} ${
            selected.status === "missing_settlement" &&
            selected.settlementStatus !== "overdue"
              ? "monitored"
              : ""
          }`}
        >
          <i />
          {reconciliationLabel(selected)}
        </span>
        <p className="drawer-summary">{selected.summary}</p>

        <div className="money-trail">
          <div>
            <span>ORDER</span>
            <strong>{formatMoney(selected.orderAmount)}</strong>
          </div>
          <ArrowRight size={17} />
          <div>
            <span>EXPECTED</span>
            <strong>
              {selected.expectedNet === null
                ? "—"
                : formatMoney(selected.expectedNet)}
            </strong>
          </div>
          <ArrowRight size={17} />
          <div>
            <span>SETTLED</span>
            <strong>
              {selected.settledAmount === null
                ? "—"
                : formatMoney(selected.settledAmount)}
            </strong>
          </div>
        </div>

        {!["gateway_missing", "pending"].includes(selected.status) && (
          <section
            className={`settlement-clock-panel ${selected.settlementStatus}`}
            aria-labelledby="settlement-clock-heading"
          >
            <div className="settlement-clock-heading">
              <div>
                <span>SETTLEMENT CLOCK</span>
                <h3 id="settlement-clock-heading">
                  {settlementLabels[selected.settlementStatus]}
                </h3>
              </div>
              <Clock3 size={20} />
            </div>

            {selected.settlementTimingEvidence ? (
              <>
                <div className="settlement-clock-grid">
                  <div>
                    <span>POLICY</span>
                    <strong>
                      {selected.settlementCycle} ·{" "}
                      {selected.settlementTimingEvidence.paymentMode}
                    </strong>
                  </div>
                  <div>
                    <span>EXPECTED BY</span>
                    <strong>
                      {formatTimestamp(selected.expectedSettlementAt)}
                    </strong>
                  </div>
                  <div>
                    <span>TRANSACTION SOURCE</span>
                    <strong>
                      {selected.transactionTimestampSource ===
                      "gateway_capture"
                        ? "Gateway capture"
                        : "Order created"}
                    </strong>
                  </div>
                  <div>
                    <span>CAPTURED AT</span>
                    <strong>{formatTimestamp(selected.transactionAt)}</strong>
                  </div>
                </div>
                <div className="settlement-policy-ledger">
                  <span>CALCULATION EVIDENCE</span>
                  <p>
                    {selected.settlementTimingEvidence.afterCaptureCutoff
                      ? "Capture was after the 15:00 IST cutoff, so the cycle began on the next business day."
                      : "Capture was within the 15:00 IST cutoff."}
                  </p>
                  <p>
                    {selected.settlementTimingEvidence.skippedNonBusinessDates
                      .length
                      ? `Skipped non-business dates: ${selected.settlementTimingEvidence.skippedNonBusinessDates.join(
                          ", ",
                        )}.`
                      : "No weekend or synthetic closure dates were skipped."}
                  </p>
                  <small>
                    {selected.settlementPolicyVersion} ·{" "}
                    {selected.settlementCalendarVersion} · fictional demo policy
                    and calendar
                  </small>
                </div>
              </>
            ) : (
              <div className="settlement-timing-unavailable">
                <strong>No settlement deadline was invented.</strong>
                <p>
                  A successful gateway capture needs a valid, offset-aware
                  transaction timestamp before PayOps can apply a settlement
                  cycle.
                </p>
              </div>
            )}
          </section>
        )}

        <div className="evidence-list">
          <p>EVIDENCE TRAIL</p>
          {selected.evidence.map((evidence, index) => (
            <div key={evidence}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <p>{evidence}</p>
            </div>
          ))}
        </div>

        <SourceEvidenceLedger evidence={selected.sourceEvidence} compact />

        <div className="suggested-action">
          <Sparkles size={18} />
          <div>
            <span>SUGGESTED NEXT STEP</span>
            <p>{suggestedNextStep(selected)}</p>
          </div>
        </div>
      </aside>
    </div>
  );
}
