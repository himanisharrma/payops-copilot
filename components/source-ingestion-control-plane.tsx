"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleDot,
  FileSearch,
  FileUp,
  GitBranch,
  Loader2,
  RadioTower,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AppRole } from "@/lib/access";
import type {
  SourceIngestionArrival,
  SourceIngestionExpectation,
  SourceIngestionWorkspace,
} from "@/lib/modules/source-ingestion/types";

type Acceptance = {
  decision?: string;
  status?: string;
  reason?: string;
  actorName?: string;
  createdAt?: string;
};

type ArrivalView = SourceIngestionArrival & {
  versionNumber?: number;
  activeAcceptance?: Acceptance | null;
};

type ExpectationView = SourceIngestionExpectation & {
  arrivals?: ArrivalView[];
  latestArrival: ArrivalView | null;
};

type Snapshot = Record<string, unknown>;
type WorkspaceView = SourceIngestionWorkspace & { latestSnapshot?: Snapshot | null };

export function SourceIngestionControlPlane({
  actorRole,
  workspace: rawWorkspace,
}: {
  actorRole: AppRole;
  workspace: SourceIngestionWorkspace;
}) {
  const workspace = rawWorkspace as WorkspaceView;
  const router = useRouter();
  const searchParams = useSearchParams();
  const canMutate = actorRole !== "viewer";
  const businessDate = workspace.summary.businessDate;
  const selectedArrivalId = searchParams.get("arrivalId");
  const expectations = workspace.expectations as ExpectationView[];
  const selectedExpectation = expectations.find((expectation) =>
    expectation.arrivals?.some((arrival) => arrival.id === selectedArrivalId) ||
    expectation.latestArrival?.id === selectedArrivalId,
  );
  const embeddedArrival = selectedExpectation
    ? (selectedExpectation.arrivals?.find((arrival) => arrival.id === selectedArrivalId) ??
      selectedExpectation.latestArrival)
    : null;
  const [arrival, setArrival] = useState<ArrivalView | null>(embeddedArrival ?? null);
  const [detailState, setDetailState] = useState<"idle" | "loading" | "error">("idle");
  const [decision, setDecision] = useState<"accepted" | "rejected" | null>(null);
  const [reason, setReason] = useState("");
  const [mutationState, setMutationState] = useState<"idle" | "saving" | "error">("idle");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const lastTriggerRef = useRef<HTMLElement | null>(null);
  const selectedArrival = arrival?.id === selectedArrivalId ? arrival : embeddedArrival;

  useEffect(() => {
    if (!selectedArrivalId) return;

    const controller = new AbortController();
    fetch(`/api/source-ingestion/versions/${selectedArrivalId}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Arrival detail could not be loaded");
        const payload = (await response.json()) as {
          arrival: ArrivalView;
          acceptedSourceContract?: {
            reason: string;
            acceptedByName: string;
            acceptedAt: string;
          } | null;
        };
        setArrival({
          ...payload.arrival,
          activeAcceptance: payload.acceptedSourceContract ? {
            status: "accepted",
            reason: payload.acceptedSourceContract.reason,
            actorName: payload.acceptedSourceContract.acceptedByName,
            createdAt: payload.acceptedSourceContract.acceptedAt,
          } : null,
        });
        setDetailState("idle");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDetailState(embeddedArrival ? "idle" : "error");
      });
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      controller.abort();
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedArrivalId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedArrivalId) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        const params = new URLSearchParams(searchParams.toString());
        params.delete("arrivalId");
        const query = params.toString();
        router.push(`/source-ingestion${query ? `?${query}` : ""}`, { scroll: false });
        window.requestAnimationFrame(() => lastTriggerRef.current?.focus());
      }
      if (event.key !== "Tab") return;
      const drawer = closeButtonRef.current?.closest<HTMLElement>("[role='dialog']");
      const focusable = drawer?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), a[href], textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])",
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  });

  function updateQuery(key: string, value?: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    const query = params.toString();
    router.push(`/source-ingestion${query ? `?${query}` : ""}`, { scroll: false });
  }

  function setBusinessDate(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("businessDate", value);
    params.delete("arrivalId");
    router.push(`/source-ingestion?${params.toString()}`);
  }

  function openDrawer(id: string, trigger: HTMLElement) {
    lastTriggerRef.current = trigger;
    setDetailState("loading");
    setDecision(null);
    setReason("");
    updateQuery("arrivalId", id);
  }

  function closeDrawer() {
    updateQuery("arrivalId");
    window.requestAnimationFrame(() => lastTriggerRef.current?.focus());
  }

  async function submitDecision() {
    if (!selectedArrival || !decision || !reason.trim()) return;
    setMutationState("saving");
    try {
      const response = await fetch(`/api/source-ingestion/versions/${selectedArrival.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: decision === "accepted" ? "accept" : "reject",
          reason: reason.trim(),
        }),
      });
      if (!response.ok) throw new Error("Decision could not be saved");
      const payload = (await response.json()) as {
        arrival: ArrivalView;
        acceptedSourceContract?: {
          reason: string;
          acceptedByName: string;
          acceptedAt: string;
        } | null;
      };
      setArrival({
        ...payload.arrival,
        activeAcceptance: payload.acceptedSourceContract ? {
          status: "accepted",
          reason: payload.acceptedSourceContract.reason,
          actorName: payload.acceptedSourceContract.acceptedByName,
          createdAt: payload.acceptedSourceContract.acceptedAt,
        } : null,
      });
      setDecision(null);
      setReason("");
      setMutationState("idle");
      router.refresh();
    } catch {
      setMutationState("error");
    }
  }

  async function uploadDemoFile(expectationId: string, sourceKind: string) {
    const form = new FormData();
    form.set("expectationId", expectationId);
    form.set("file", new File([demoCsvFor(sourceKind)], `${sourceKind}-demo.csv`, { type: "text/csv" }));
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
          {workspace.summary.verdict === "ready" ? <CheckCircle2 size={30} /> : <AlertTriangle size={30} />}
          <span>Daily readiness</span>
          <strong>{workspace.summary.verdict === "ready" ? "Ready to run reconciliation" : `${workspace.summary.blockingFiles} blocker${workspace.summary.blockingFiles === 1 ? "" : "s"} before close`}</strong>
          <small>{businessDate}</small>
        </aside>
      </div>

      <div className="source-plane-toolbar">
        <label>Business date<input type="date" value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} /></label>
        <p>This board is the missing upstream control from the gap review: before matching, PayOps must prove the right source files arrived and were accepted.</p>
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
          <header><div><span>Expected-file registry</span><h2>Arrival strips</h2></div><RadioTower size={22} /></header>
          {expectations.length === 0 ? (
            <div className="source-empty-state"><strong>No source expectations for this date.</strong><p>Seed demo data or register an expected file to see readiness, diagnostics, and source lineage.</p></div>
          ) : expectations.map((item) => {
            const arrivals = item.arrivals?.length ? item.arrivals : item.latestArrival ? [item.latestArrival] : [];
            return (
              <article className="source-arrival-strip" key={item.id}>
                <div className="source-strip-time"><span>{formatTime(item.expectedArrivalAt)}</span><small>{item.requiredForClose ? "required" : "optional"}</small></div>
                <div className="source-strip-main">
                  <div><strong>{item.displayName}</strong><small>{item.providerId} · {humanize(item.sourceKind)} · {humanize(item.transportType)}</small></div>
                  {item.latestArrival ? (
                    <><dl><div><dt>Status</dt><dd>{item.latestArrival.validationStatus}</dd></div><div><dt>Class</dt><dd>{humanize(item.latestArrival.classification)}</dd></div><div><dt>Rows</dt><dd>{item.latestArrival.sourceRowCount}</dd></div><div><dt>Hash</dt><dd>{item.latestArrival.fileHash.slice(0, 10)}</dd></div></dl>
                    <div className="source-version-buttons" aria-label={`${item.displayName} versions`}>
                      {arrivals.map((version, index) => <button key={version.id} className={version.id === selectedArrivalId ? "selected" : ""} aria-current={version.id === selectedArrivalId ? "true" : undefined} onClick={(event) => openDrawer(version.id, event.currentTarget)}><span>v{version.versionNumber ?? arrivals.length - index}</span>{version.fileName}<ArrowRight size={14} /></button>)}
                    </div></>
                  ) : <p className="source-blocker-copy">Missing source. Reconciliation should not run if this file is required for close.</p>}
                </div>
                <div className="source-strip-action"><span className={`source-status-pill ${statusTone(item)}`}>{item.latestArrival?.validationStatus ?? item.status}</span>{canMutate && !item.latestArrival && <button onClick={() => uploadDemoFile(item.id, item.sourceKind)}><FileUp size={15} />Upload demo CSV</button>}</div>
              </article>
            );
          })}
        </section>

        <aside className="source-proof-rail" aria-label="Source evidence timeline">
          <header><div><span>Proof rail</span><h2>Latest source events</h2></div></header>
          <ol>{workspace.events.map((event) => <li key={event.id}><span>{humanize(event.eventType)}</span><strong>{event.actorName}</strong><small>{formatDateTime(event.createdAt)}</small></li>)}</ol>
          <div className="source-next-link"><strong>Next control after ingestion</strong><p>Accepted files feed the recon and import story; quarantined files stop there.</p><Link href="/runs">Open run history</Link></div>
        </aside>
      </div>

      {selectedArrivalId && (
        <div className="source-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDrawer(); }}>
          <aside className="source-version-drawer" role="dialog" aria-modal="true" aria-labelledby="source-drawer-title" aria-describedby="source-drawer-description">
            <header>
              <button ref={closeButtonRef} className="source-drawer-close" onClick={closeDrawer} aria-label="Close source version detail"><X /></button>
            </header>
            {(detailState === "loading" && !selectedArrival) ? <div className="source-drawer-state"><Loader2 className="source-spin" /><strong>Loading source evidence</strong></div> : detailState === "error" ? <div className="source-drawer-state"><AlertTriangle /><strong>Source evidence could not be loaded.</strong><button onClick={() => router.refresh()}>Try again</button></div> : selectedArrival && selectedExpectation ? (
              <div className="source-drawer-body">
                <section className="source-drawer-summary"><div><span>Version</span><strong>v{selectedArrival.versionNumber ?? 1}</strong></div><div><span>Classification</span><strong>{humanize(selectedArrival.classification)}</strong></div><div><span>Validation</span><strong>{humanize(selectedArrival.validationStatus)}</strong></div><div><span>Rows accepted</span><strong>{selectedArrival.acceptedRowCount}/{selectedArrival.sourceRowCount}</strong></div></section>
                <section className="source-lineage-section"><SectionTitle icon={<GitBranch />} eyebrow="Provenance" title="Version lineage" /><ol className="source-lineage-rail">{lineageFor(selectedExpectation, selectedArrival).map((version) => <li key={version.id} className={version.id === selectedArrival.id ? "active" : ""}><CircleDot /><button onClick={(event) => openDrawer(version.id, event.currentTarget)}><strong>v{version.versionNumber ?? 1} · {version.fileName}</strong><span>{formatDateTime(version.receivedAt)} · {humanize(version.classification)}</span><code>{version.fileHash.slice(0, 16)}</code></button></li>)}</ol></section>
                <EvidenceSection icon={<FileSearch />} eyebrow="Parse evidence" title="Diagnostics"><DiagnosticList arrival={selectedArrival} /></EvidenceSection>
                <EvidenceSection icon={<ShieldCheck />} eyebrow="Schema & totals" title="Profile"><EvidenceGrid value={{ headers: selectedArrival.evidence.headers, missingHeaders: selectedArrival.evidence.missingHeaders, amountTotals: selectedArrival.evidence.amountTotals, dateRange: selectedArrival.evidence.dateRange, rows: { source: selectedArrival.sourceRowCount, accepted: selectedArrival.acceptedRowCount, rejected: selectedArrival.rejectedRowCount } }} /></EvidenceSection>
                <EvidenceSection icon={<ArrowRight />} eyebrow="Control routing" title="Downstream"><EvidenceGrid value={{ workflow: selectedArrival.downstreamWorkflow, reconciliationRun: selectedArrival.linkedReconciliationRunId, settlementImport: selectedArrival.linkedSettlementImportId }} /></EvidenceSection>
                <EvidenceSection icon={<CheckCircle2 />} eyebrow="At arrival time" title="Readiness snapshot"><EvidenceGrid value={workspace.latestSnapshot ?? { verdict: workspace.summary.verdict, blockers: workspace.summary.blockingFiles, acceptedFiles: workspace.summary.acceptedFiles, businessDate }} /></EvidenceSection>
                <DecisionPanel arrival={selectedArrival} canMutate={canMutate} actorRole={actorRole} decision={decision} reason={reason} mutationState={mutationState} onDecision={setDecision} onReason={setReason} onSubmit={submitDecision} />
              </div>
            ) : null}
          </aside>
        </div>
      )}
    </section>
  );
}

function SectionTitle({ icon, eyebrow, title }: { icon: React.ReactNode; eyebrow: string; title: string }) { return <header className="source-section-title"><span className="source-section-icon">{icon}</span><div><span>{eyebrow}</span><h3>{title}</h3></div></header>; }
function EvidenceSection({ icon, eyebrow, title, children }: { icon: React.ReactNode; eyebrow: string; title: string; children: React.ReactNode }) { return <section className="source-evidence-section"><SectionTitle icon={icon} eyebrow={eyebrow} title={title} />{children}</section>; }
function DiagnosticList({ arrival }: { arrival: ArrivalView }) { const diagnostics = arrival.evidence.diagnostics ?? []; return diagnostics.length ? <ul className="source-diagnostic-list">{diagnostics.map((diagnostic, index) => <li className={diagnostic.severity} key={`${diagnostic.code}-${index}`}><span>{diagnostic.severity}</span><div><strong>{humanize(diagnostic.code)}</strong><p>{diagnostic.message}</p></div></li>)}</ul> : <p className="source-clean-note"><Check size={18} /> No parse diagnostics were recorded for this version.</p>; }
function EvidenceGrid({ value }: { value: Record<string, unknown> }) { const entries = Object.entries(value).filter(([, entry]) => entry !== undefined); return <dl className="source-evidence-grid">{entries.map(([key, entry]) => <div key={key}><dt>{humanize(key)}</dt><dd>{formatEvidence(entry)}</dd></div>)}</dl>; }
function DecisionPanel({ arrival, canMutate, actorRole, decision, reason, mutationState, onDecision, onReason, onSubmit }: { arrival: ArrivalView; canMutate: boolean; actorRole: AppRole; decision: "accepted" | "rejected" | null; reason: string; mutationState: "idle" | "saving" | "error"; onDecision: (value: "accepted" | "rejected") => void; onReason: (value: string) => void; onSubmit: () => void }) {
  const active = arrival.activeAcceptance;
  return <section className="source-decision-panel"><SectionTitle icon={<ShieldCheck />} eyebrow="Maker / checker record" title="Acceptance decision" />{active && <div className="source-active-decision"><span className={`source-status-pill ${(active.decision ?? active.status) === "accepted" ? "ok" : "bad"}`}>{humanize(active.decision ?? active.status ?? "recorded")}</span><p>{active.reason || "No reason recorded."}</p><small>{active.actorName}{active.createdAt ? ` · ${formatDateTime(active.createdAt)}` : ""}</small></div>}{canMutate && arrival.validationStatus === "needs_review" ? <div className="source-decision-form"><div className="source-decision-toggle" role="group" aria-label="Acceptance decision"><button className={decision === "accepted" ? "selected accept" : ""} onClick={() => onDecision("accepted")}><Check />Accept</button><button className={decision === "rejected" ? "selected reject" : ""} onClick={() => onDecision("rejected")}><X />Reject</button></div>{decision && <label>Reason <span>required</span><textarea value={reason} onChange={(event) => onReason(event.target.value)} rows={3} required aria-invalid={!reason.trim()} placeholder={`Why should this version be ${decision}?`} /></label>}<button className="source-submit-decision" disabled={!decision || !reason.trim() || mutationState === "saving"} onClick={onSubmit}>{mutationState === "saving" && <Loader2 className="source-spin" />}Record decision</button>{mutationState === "error" && <p className="source-form-error" role="alert">The decision was not saved. Check the reason and try again.</p>}</div> : <p className="source-read-only-note"><ShieldCheck />You are viewing this evidence as a {actorRole}. Acceptance controls are read-only.</p>}</section>;
}

function Metric({ label, value }: { label: string; value: number }) { return <article><span>{label}</span><strong>{value}</strong></article>; }
function statusTone(item: SourceIngestionExpectation) { if (item.latestArrival?.validationStatus === "accepted") return "ok"; if (item.latestArrival?.validationStatus === "needs_review") return "warn"; return "bad"; }
function lineageFor(expectation: ExpectationView, selected: ArrivalView) { const versions = expectation.arrivals?.length ? expectation.arrivals : [selected]; return [...versions].sort((a, b) => (b.versionNumber ?? 0) - (a.versionNumber ?? 0)); }
function humanize(value: string) { return value.replaceAll("_", " "); }
function formatTime(value: string) { return new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date(value)); }
function formatDateTime(value: string) { return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(value)); }
function formatEvidence(value: unknown): React.ReactNode { if (value === null || value === "") return <span className="source-null">Not linked</span>; if (Array.isArray(value)) return value.length ? value.join(", ") : <span className="source-null">None</span>; if (typeof value === "object") return <code>{Object.entries(value as Record<string, unknown>).map(([key, entry]) => `${humanize(key)}: ${String(entry ?? "—")}`).join(" · ")}</code>; return String(value); }
function demoCsvFor(sourceKind: string) { if (sourceKind === "bank_statement") return "bank_reference,utr,amount,credited_at\nBNK-DEMO-1,UTR-DEMO-1,1200,2026-06-26"; if (sourceKind === "settlement_statement") return "statement_reference,order_id,net_amount,utr\nSTM-DEMO-1,ORD-DEMO-1,1200,UTR-DEMO-1"; if (sourceKind === "refunds_report") return "order_id,refund_amount,refund_reference\nORD-DEMO-2,150,REF-DEMO-1"; if (sourceKind === "chargebacks_report") return "order_id,chargeback_amount,dispute_reference\nORD-DEMO-3,200,DISP-DEMO-1"; return "order_id,gateway_reference,amount,status,payment_mode\nORD-DEMO-1,GW-DEMO-1,1200,captured,upi"; }
