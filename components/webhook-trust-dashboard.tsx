import {
  Activity,
  CheckCircle2,
  KeyRound,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { providerName } from "@/lib/provider-webhooks";
import type { ProviderWebhookObservability } from "@/lib/types";

const dateTime = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));

export function WebhookTrustDashboard({
  observability,
}: {
  observability: ProviderWebhookObservability;
}) {
  const summary = observability.summary;
  return (
    <>
      <section className="workspace-hero compact-hero webhook-trust-hero">
        <div>
          <p className="kicker">
            <span>WEBHOOK TRUST OPERATIONS</span>
            <span>ADMIN EVIDENCE</span>
          </p>
          <h1>Know which inbound evidence crossed the boundary.</h1>
          <p>
            Inspect synthetic signature outcomes, rotation-key usage, latency,
            and replay evidence without retaining payloads or credentials.
          </p>
        </div>
        <div className="trust-boundary-card">
          <ShieldCheck size={25} />
          <span>BOUNDARY</span>
          <strong>Hash-only evidence</strong>
          <p>No raw request body or signing secret is persisted.</p>
        </div>
      </section>

      <div className="webhook-trust-page">
        <section className="trust-kpi-ledger" aria-label="Webhook attempt summary">
          <article>
            <span>TOTAL ATTEMPTS</span>
            <strong>{summary.total}</strong>
            <small>Known organization only</small>
          </article>
          <article>
            <span>ACCEPTED</span>
            <strong>{summary.accepted}</strong>
            <small>{summary.duplicate} idempotent duplicates</small>
          </article>
          <article>
            <span>REJECTED</span>
            <strong>{summary.rejected}</strong>
            <small>{summary.conflict} event-ID conflicts</small>
          </article>
          <article>
            <span>PREVIOUS KEY</span>
            <strong>{summary.previousKeyAccepted}</strong>
            <small>Accepted during rotation window</small>
          </article>
          <article>
            <span>AVG PROCESSING</span>
            <strong>
              {summary.averageProcessingMs === null
                ? "—"
                : `${summary.averageProcessingMs.toFixed(0)}ms`}
            </strong>
            <small>{summary.failed} processing failures</small>
          </article>
        </section>

        <section className="trust-provider-panel">
          <header>
            <div>
              <span>KEY ROTATION SPINE</span>
              <h2>Provider contract evidence</h2>
            </div>
            <KeyRound size={21} />
          </header>
          <div className="trust-provider-grid">
            {observability.byProvider.length ? (
              observability.byProvider.map((provider) => (
                <article key={provider.providerId}>
                  <div className="trust-provider-marker">
                    <i />
                    <RotateCcw size={17} />
                  </div>
                  <div>
                    <strong>{providerName(provider.providerId)}</strong>
                    <p>{provider.total} signed attempts observed</p>
                  </div>
                  <dl>
                    <div>
                      <dt>Accepted</dt>
                      <dd>{provider.accepted}</dd>
                    </div>
                    <div>
                      <dt>Rejected</dt>
                      <dd>{provider.rejected}</dd>
                    </div>
                    <div>
                      <dt>Previous key</dt>
                      <dd>{provider.previousKeyAccepted}</dd>
                    </div>
                  </dl>
                </article>
              ))
            ) : (
              <div className="trust-empty">
                <Activity size={22} />
                <p>No signed webhook attempts have been observed.</p>
              </div>
            )}
          </div>
        </section>

        <section className="trust-attempt-panel">
          <header>
            <div>
              <span>ATTEMPT LEDGER</span>
              <h2>Recent inbound decisions</h2>
            </div>
            <p>Newest first · maximum 100</p>
          </header>
          <div className="trust-attempt-head">
            <span>Outcome</span>
            <span>Provider / event</span>
            <span>Contract / key</span>
            <span>Evidence</span>
            <span>Received</span>
          </div>
          <div className="trust-attempt-list">
            {observability.recent.length ? (
              observability.recent.map((attempt) => (
                <article key={attempt.id}>
                  <span className={`trust-outcome ${attempt.outcome}`}>
                    {attempt.outcome === "accepted" ||
                    attempt.outcome === "duplicate" ? (
                      <CheckCircle2 size={13} />
                    ) : (
                      <ShieldAlert size={13} />
                    )}
                    {attempt.outcome}
                  </span>
                  <div>
                    <strong>{providerName(attempt.providerId)}</strong>
                    <code>{attempt.externalEventId}</code>
                  </div>
                  <div>
                    <strong>{attempt.signatureVersion}</strong>
                    <small>
                      {attempt.signatureKeyId ?? "No key"}{" "}
                      {attempt.keyState ? `· ${attempt.keyState}` : ""}
                    </small>
                  </div>
                  <div>
                    <strong>{attempt.httpStatus}</strong>
                    <small>
                      {attempt.failureCode ??
                        `${attempt.matchedRecords} linked records`}
                    </small>
                  </div>
                  <div>
                    <strong>{dateTime(attempt.receivedAt)}</strong>
                    <small>{attempt.processingMs}ms</small>
                  </div>
                </article>
              ))
            ) : (
              <div className="trust-empty">
                <ShieldCheck size={22} />
                <p>No attempt evidence yet.</p>
              </div>
            )}
          </div>
        </section>

        <p className="trust-boundary-note">
          These are fictional provider-specific contracts for portfolio
          demonstration. They do not claim compatibility with production
          Razorpay, Cashfree, or PayU signature schemes.
        </p>
      </div>
    </>
  );
}
