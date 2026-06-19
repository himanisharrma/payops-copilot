"use client";

import { CheckCircle2, LoaderCircle } from "lucide-react";

export function CaseResolutionControl({
  saving,
  reason,
  evidenceConfirmed,
  onReasonChange,
  onEvidenceConfirmedChange,
  onCancel,
  onResolve,
}: {
  saving: boolean;
  reason: string;
  evidenceConfirmed: boolean;
  onReasonChange: (value: string) => void;
  onEvidenceConfirmedChange: (value: boolean) => void;
  onCancel: () => void;
  onResolve: () => void;
}) {
  return (
    <section className="case-resolution-panel">
      <div>
        <p>RESOLUTION CONTROL</p>
        <h3>Close this case against durable evidence.</h3>
        <span>
          Resolution records are attributed and committed with the audit event.
        </span>
      </div>
      <label>
        RESOLUTION REASON
        <textarea
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
          placeholder="Explain what was verified and why the discrepancy is resolved."
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
          I reviewed the persisted order, gateway, and settlement evidence
          available for this case.
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
          onClick={onResolve}
          disabled={
            saving || reason.trim().length < 10 || !evidenceConfirmed
          }
        >
          {saving ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <CheckCircle2 size={16} />
          )}
          Resolve case
        </button>
      </div>
    </section>
  );
}

export function CaseResolutionRecord({
  reason,
  resolvedByName,
  resolvedAt,
  formatDateTime,
}: {
  reason: string | null;
  resolvedByName: string | null;
  resolvedAt: string;
  formatDateTime: (value: string) => string;
}) {
  return (
    <section className="case-resolution-record">
      <div>
        <CheckCircle2 size={18} />
        <span>RESOLUTION RECORD</span>
      </div>
      <p>{reason}</p>
      <small>
        Evidence confirmed by {resolvedByName ?? "Unknown"} ·{" "}
        {formatDateTime(resolvedAt)}
      </small>
    </section>
  );
}
