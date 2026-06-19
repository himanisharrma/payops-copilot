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
} from "@/lib/types";

const statusLabels: Record<ReconciliationStatus, string> = {
  matched: "Matched",
  amount_mismatch: "Amount mismatch",
  missing_settlement: "Missing settlement",
  gateway_missing: "Gateway missing",
  duplicate: "Duplicate capture",
  pending: "Pending",
};

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
        <p className="eyebrow">EXCEPTION EVIDENCE</p>
        <div className={`drawer-icon ${selected.status}`}>
          {selected.status === "matched" ? (
            <BadgeCheck size={28} />
          ) : selected.status === "pending" ? (
            <Clock3 size={28} />
          ) : (
            <AlertTriangle size={28} />
          )}
        </div>
        <h2>{selected.orderId}</h2>
        <span className={`status-pill ${selected.status}`}>
          <i />
          {statusLabels[selected.status]}
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
            <p>
              {selected.status === "matched"
                ? "No action needed. Keep this transaction in the audit record."
                : selected.status === "pending"
                  ? "Wait for the gateway status to become final, then run reconciliation again."
                  : "Confirm the source row with the payment provider before changing any financial record."}
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}
