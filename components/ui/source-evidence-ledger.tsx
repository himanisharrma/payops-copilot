import { AlertTriangle } from "lucide-react";
import type { SourceEvidence } from "@/lib/types";

function displayValue(value: string | number | null) {
  return value === null || value === "" ? "—" : String(value);
}

export function SourceEvidenceLedger({
  evidence,
  compact = false,
  emptyMessage = "No durable source rows are available.",
}: {
  evidence: SourceEvidence[];
  compact?: boolean;
  emptyMessage?: string;
}) {
  if (compact) {
    return (
      <div className="source-row-preview">
        <div>
          <p>SOURCE ROW LEDGER</p>
          <span>{evidence.length} persisted snapshots</span>
        </div>
        {evidence.map((item) => (
          <article key={`${item.sourceType}-${item.rowNumber}`}>
            <div>
              <strong>
                {item.sourceType} · row {item.rowNumber}
              </strong>
              <code>{item.integrityHash.slice(0, 16)}…</code>
            </div>
            <p>
              {Object.entries(item.normalizedValues)
                .map(([key, value]) => `${key}: ${displayValue(value)}`)
                .join(" · ")}
            </p>
          </article>
        ))}
      </div>
    );
  }

  return (
    <section className="source-evidence-panel">
      <div className="timeline-heading">
        <span>SOURCE ROW LEDGER</span>
        <small>{evidence.length} rows</small>
      </div>
      {evidence.length ? (
        evidence.map((item) => (
          <article key={`${item.sourceType}-${item.rowNumber}`}>
            <div>
              <strong>
                {item.sourceType} · row {item.rowNumber}
              </strong>
              <code>{item.integrityHash.slice(0, 16)}…</code>
            </div>
            <dl>
              {Object.entries(item.normalizedValues).map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{displayValue(value)}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))
      ) : (
        <div className="provider-event-empty">
          <AlertTriangle size={15} />
          {emptyMessage}
        </div>
      )}
    </section>
  );
}
