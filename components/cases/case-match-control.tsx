"use client";

import {
  AlertOctagon,
  CheckCircle2,
  LoaderCircle,
  ShieldAlert,
  Undo2,
  XCircle,
} from "lucide-react";
import type { ManualOverrideSummary } from "@/lib/types";

export type ManualOverrideKind = "match" | "unmatch";

export function CaseMatchControl({
  kind,
  saving,
  reason,
  evidenceConfirmed,
  onReasonChange,
  onEvidenceConfirmedChange,
  onCancel,
  onSubmit,
}: {
  kind: ManualOverrideKind;
  saving: boolean;
  reason: string;
  evidenceConfirmed: boolean;
  onReasonChange: (value: string) => void;
  onEvidenceConfirmedChange: (value: boolean) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const isMatch = kind === "match";
  return (
    <section className="case-resolution-panel manual-override-panel">
      <div>
        <p>{isMatch ? "MANUAL MATCH" : "MANUAL UNMATCH"}</p>
        <h3>
          {isMatch
            ? "Override the engine and mark this exception as truly matched."
            : "Propose unmatching an engine match for admin review."}
        </h3>
        <span>
          {isMatch
            ? "Applied immediately and attributed to you in the audit log."
            : "An administrator different from you must approve this proposal."}
        </span>
      </div>
      <label>
        OVERRIDE REASON
        <textarea
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
          placeholder={
            isMatch
              ? "Explain how the engine's exception is wrong (e.g. UTR ties out against bank credit BNK-501)."
              : "Explain why the engine match should not stand (e.g. duplicate payment, refund posted before settlement)."
          }
          disabled={saving}
        />
      </label>
      <label className="resolution-confirmation">
        <input
          type="checkbox"
          checked={evidenceConfirmed}
          onChange={(event) =>
            onEvidenceConfirmedChange(event.target.checked)
          }
          disabled={saving}
        />
        <span>
          I reviewed the persisted order, gateway, and settlement evidence and
          take responsibility for this override.
        </span>
      </label>
      <div className="resolution-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={saving || reason.trim().length < 10 || !evidenceConfirmed}
        >
          {saving ? (
            <LoaderCircle className="spin" size={16} />
          ) : isMatch ? (
            <CheckCircle2 size={16} />
          ) : (
            <ShieldAlert size={16} />
          )}
          {isMatch ? "Apply manual match" : "Submit unmatch for approval"}
        </button>
      </div>
    </section>
  );
}

export function CaseManualOverrideRecord({
  override,
  formatDateTime,
}: {
  override: ManualOverrideSummary;
  formatDateTime: (value: string) => string;
}) {
  const isMatch = override.proposalType === "manual_match";
  const statusLabel = override.status.replace(/_/g, " ");
  return (
    <section className="case-resolution-record manual-override-record">
      <div>
        <AlertOctagon size={18} />
        <span>MANUAL OVERRIDE · {statusLabel.toUpperCase()}</span>
      </div>
      <p>
        <strong>{isMatch ? "Manual match" : "Manual unmatch"}:</strong>{" "}
        {override.reason}
      </p>
      <small>
        Proposed by {override.proposedByName} ·{" "}
        {formatDateTime(override.proposedAt)}
        {override.decidedAt
          ? ` · Decided by ${override.decidedByName ?? "Unknown"} (${formatDateTime(override.decidedAt)})`
          : ""}
      </small>
      {override.decisionReason ? (
        <small>Decision note: {override.decisionReason}</small>
      ) : null}
    </section>
  );
}

export function CaseManualUnmatchDecision({
  saving,
  decisionReason,
  onDecisionReasonChange,
  onApprove,
  onReject,
  onWithdraw,
  showWithdraw,
}: {
  saving: boolean;
  decisionReason: string;
  onDecisionReasonChange: (value: string) => void;
  onApprove: () => void;
  onReject: () => void;
  onWithdraw: () => void;
  showWithdraw: boolean;
}) {
  return (
    <section className="case-resolution-panel manual-override-decision">
      <div>
        <p>MANUAL UNMATCH DECISION</p>
        <h3>Approve or reject this pending unmatch.</h3>
        <span>
          A different administrator from the proposer must approve. Withdrawals
          are recorded with the original proposer&apos;s identity.
        </span>
      </div>
      <label>
        DECISION REASON
        <textarea
          value={decisionReason}
          onChange={(event) => onDecisionReasonChange(event.target.value)}
          placeholder="Explain the decision basis (required for approve/reject)."
          disabled={saving}
        />
      </label>
      <div className="resolution-actions manual-override-decision-actions">
        {showWithdraw ? (
          <button
            type="button"
            className="secondary-button"
            onClick={onWithdraw}
            disabled={saving}
          >
            <Undo2 size={16} />
            Withdraw
          </button>
        ) : null}
        <button
          type="button"
          className="secondary-button"
          onClick={onReject}
          disabled={saving || decisionReason.trim().length < 10}
        >
          {saving ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <XCircle size={16} />
          )}
          Reject
        </button>
        <button
          type="button"
          onClick={onApprove}
          disabled={saving || decisionReason.trim().length < 10}
        >
          {saving ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <CheckCircle2 size={16} />
          )}
          Approve
        </button>
      </div>
    </section>
  );
}

export function CaseEngineVerdict({
  matchStrategy,
  matchConfidence,
  reasonCode,
}: {
  matchStrategy: string | null;
  matchConfidence: string | null;
  reasonCode: string | null;
}) {
  if (!matchStrategy && !reasonCode) return null;
  return (
    <p className="case-engine-verdict">
      <span>ENGINE VERDICT</span>
      Strategy {matchStrategy ?? "n/a"} · confidence{" "}
      {matchConfidence ?? "n/a"} · reason {reasonCode ?? "none"}
    </p>
  );
}
