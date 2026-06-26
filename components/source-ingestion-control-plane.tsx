"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileUp, RadioTower } from "lucide-react";
import type { AppRole } from "@/lib/access";
import type { SourceIngestionWorkspace } from "@/lib/modules/source-ingestion/types";

export function SourceIngestionControlPlane({
  actorRole,
  workspace,
}: {
  actorRole: AppRole;
  workspace: SourceIngestionWorkspace;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const canMutate = actorRole !== "viewer";
  const businessDate = workspace.summary.businessDate;

  function setBusinessDate(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("businessDate", value);
    router.push(`/source-ingestion?${params.toString()}`);
  }

  async function uploadDemoFile(expectationId: string, sourceKind: string) {
    const form = new FormData();
    form.set("expectationId", expectationId);
    form.set(
      "file",
      new File([demoCsvFor(sourceKind)], `${sourceKind}-demo.csv`, {
        type: "text/csv",
      }),
    );
    await fetch("/api/source-ingestion", { method: "POST", body: form });
    router.refresh();
  }

  return (
    <section className="source-plane">
      <div className="workspace-hero compact-hero source-plane-hero">
        <div>
          <span>Source ingestion control plane</span>
          <h1>Know if today’s files are ready before recon runs.</h1>
          <p>
            Track expected merchant payment sources, arrival SLAs, CSV profiles,
            quarantines, duplicates, revisions, and readiness blockers. Synthetic
            manual intake only — no live provider, bank, email, SFTP, or API pull.
          </p>
        </div>
        <aside className={`source-readiness ${workspace.summary.verdict}`}>
          {workspace.summary.verdict === "ready" ? (
            <CheckCircle2 size={30} />
          ) : (
            <AlertTriangle size={30} />
          )}
          <span>Daily readiness</span>
          <strong>
            {workspace.summary.verdict === "ready"
              ? "Ready to run reconciliation"
              : `${workspace.summary.blockingFiles} blocker${
                  workspace.summary.blockingFiles === 1 ? "" : "s"
                } before close`}
          </strong>
          <small>{businessDate}</small>
        </aside>
      </div>

      <div className="source-plane-toolbar">
        <label>
          Business date
          <input
            type="date"
            value={businessDate}
            onChange={(event) => setBusinessDate(event.target.value)}
          />
        </label>
        <p>
          This board is the missing upstream control from the gap review: before
          matching, PayOps must prove the right source files arrived and were
          accepted.
        </p>
      </div>

      <div className="source-kpi-ledger">
        <Metric label="Expected" value={workspace.summary.expectedFiles} />
        <Metric label="Accepted" value={workspace.summary.acceptedFiles} />
        <Metric label="Missing" value={workspace.summary.missingFiles} />
        <Metric label="Late" value={workspace.summary.lateFiles} />
        <Metric label="Quarantined" value={workspace.summary.quarantinedFiles} />
        <Metric label="Optional warnings" value={workspace.summary.optionalWarnings} />
      </div>

      <div className="source-plane-grid">
        <section className="source-arrival-board" aria-label="Expected sources">
          <header>
            <div>
              <span>Expected-file registry</span>
              <h2>Arrival strips</h2>
            </div>
            <RadioTower size={22} />
          </header>
          {workspace.expectations.length === 0 ? (
            <div className="source-empty-state">
              <strong>No source expectations for this date.</strong>
              <p>
                Seed demo data or register an expected file to see readiness,
                diagnostics, and source lineage.
              </p>
            </div>
          ) : (
            workspace.expectations.map((item) => (
              <article className="source-arrival-strip" key={item.id}>
                <div className="source-strip-time">
                  <span>{new Date(item.expectedArrivalAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}</span>
                  <small>{item.requiredForClose ? "required" : "optional"}</small>
                </div>
                <div className="source-strip-main">
                  <div>
                    <strong>{item.displayName}</strong>
                    <small>
                      {item.providerId} · {item.sourceKind.replaceAll("_", " ")} ·{" "}
                      {item.transportType.replaceAll("_", " ")}
                    </small>
                  </div>
                  {item.latestArrival ? (
                    <dl>
                      <div>
                        <dt>Status</dt>
                        <dd>{item.latestArrival.validationStatus}</dd>
                      </div>
                      <div>
                        <dt>Class</dt>
                        <dd>{item.latestArrival.classification.replaceAll("_", " ")}</dd>
                      </div>
                      <div>
                        <dt>Rows</dt>
                        <dd>{item.latestArrival.sourceRowCount}</dd>
                      </div>
                      <div>
                        <dt>Hash</dt>
                        <dd>{item.latestArrival.fileHash.slice(0, 10)}</dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="source-blocker-copy">
                      Missing source. Reconciliation should not run if this file
                      is required for close.
                    </p>
                  )}
                </div>
                <div className="source-strip-action">
                  <span className={`source-status-pill ${statusTone(item)}`}>
                    {item.latestArrival?.validationStatus ?? item.status}
                  </span>
                  {canMutate && !item.latestArrival && (
                    <button onClick={() => uploadDemoFile(item.id, item.sourceKind)}>
                      <FileUp size={15} />
                      Upload demo CSV
                    </button>
                  )}
                </div>
              </article>
            ))
          )}
        </section>

        <aside className="source-proof-rail" aria-label="Source evidence timeline">
          <header>
            <span>Proof rail</span>
            <h2>Latest source events</h2>
          </header>
          <ol>
            {workspace.events.map((event) => (
              <li key={event.id}>
                <span>{event.eventType.replaceAll("_", " ")}</span>
                <strong>{event.actorName}</strong>
                <small>{new Date(event.createdAt).toLocaleString()}</small>
              </li>
            ))}
          </ol>
          <div className="source-next-link">
            <strong>Next control after ingestion</strong>
            <p>Accepted files feed the recon and import story; quarantined files stop there.</p>
            <Link href="/runs">Open run history</Link>
          </div>
        </aside>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function statusTone(item: SourceIngestionWorkspace["expectations"][number]) {
  if (item.latestArrival?.validationStatus === "accepted") return "ok";
  if (item.latestArrival?.validationStatus === "needs_review") return "warn";
  return "bad";
}

function demoCsvFor(sourceKind: string) {
  if (sourceKind === "bank_statement") {
    return "bank_reference,utr,amount,credited_at\nBNK-DEMO-1,UTR-DEMO-1,1200,2026-06-26";
  }
  if (sourceKind === "settlement_statement") {
    return "statement_reference,order_id,net_amount,utr\nSTM-DEMO-1,ORD-DEMO-1,1200,UTR-DEMO-1";
  }
  if (sourceKind === "refunds_report") {
    return "order_id,refund_amount,refund_reference\nORD-DEMO-2,150,REF-DEMO-1";
  }
  if (sourceKind === "chargebacks_report") {
    return "order_id,chargeback_amount,dispute_reference\nORD-DEMO-3,200,DISP-DEMO-1";
  }
  return "order_id,gateway_reference,amount,status,payment_mode\nORD-DEMO-1,GW-DEMO-1,1200,captured,upi";
}
