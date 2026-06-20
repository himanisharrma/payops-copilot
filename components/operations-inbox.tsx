"use client";

import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  CircleDot,
  Clock3,
  Copy,
  LoaderCircle,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CaseQueue,
  caseSlaLabels as slaLabels,
} from "@/components/cases/case-queue";
import {
  CaseResolutionControl,
  CaseResolutionRecord,
} from "@/components/cases/case-resolution-control";
import { ProviderEventTimeline } from "@/components/ui/provider-event-timeline";
import { SourceEvidenceLedger } from "@/components/ui/source-evidence-ledger";
import { formatSlaDistance, getSlaStatus, SLA_HOURS } from "@/lib/sla";
import type {
  CaseStatus,
  OperationsCase,
  OperationsCaseComment,
  OperationsFilters,
} from "@/lib/types";

const formatMoney = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));

const currentSlaStatus = (item: OperationsCase) =>
  getSlaStatus({
    createdAt: item.createdAt,
    dueAt: item.dueAt,
    resolvedAt: item.resolvedAt,
    status: item.status,
    priority: item.priority,
  });

export function OperationsInbox({
  canEdit,
  initialFilters,
}: {
  canEdit: boolean;
  initialFilters: OperationsFilters;
}) {
  const router = useRouter();
  const [cases, setCases] = useState<OperationsCase[]>([]);
  const [selected, setSelected] = useState<OperationsCase | null>(null);
  const [filter, setFilter] = useState<"all" | CaseStatus>(
    initialFilters.status,
  );
  const [slaFilter, setSlaFilter] = useState<
    "all" | "at_risk" | "overdue"
  >(initialFilters.sla);
  const [query, setQuery] = useState(initialFilters.query);
  const [exceptionFilter, setExceptionFilter] = useState(
    initialFilters.exception,
  );
  const [providerFilter, setProviderFilter] = useState(
    initialFilters.provider,
  );
  const [paymentModeFilter, setPaymentModeFilter] = useState(
    initialFilters.paymentMode,
  );
  const [priorityFilter, setPriorityFilter] = useState(
    initialFilters.priority,
  );
  const [ownerFilter, setOwnerFilter] = useState(initialFilters.owner);
  const [ageFilter, setAgeFilter] = useState(initialFilters.age);
  const [filterNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [investigating, setInvestigating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pendingResolution, setPendingResolution] = useState(false);
  const [resolutionReason, setResolutionReason] = useState("");
  const [evidenceConfirmed, setEvidenceConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOwner, setBulkOwner] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [comments, setComments] = useState<OperationsCaseComment[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [commentSaving, setCommentSaving] = useState(false);
  const selectedCaseId = selected?.id;

  useEffect(() => {
    let active = true;
    fetch("/api/cases")
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        return payload.cases as OperationsCase[];
      })
      .then((loadedCases) => {
        if (active) {
          setCases(loadedCases);
          if (initialFilters.caseId) {
            setSelected(
              loadedCases.find((item) => item.id === initialFilters.caseId) ??
                null,
            );
          }
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(
            caught instanceof Error ? caught.message : "Cases unavailable.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [initialFilters.caseId]);

  useEffect(() => {
    if (!selectedCaseId) return;
    let active = true;
    fetch(`/api/cases/${selectedCaseId}/comments`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        return payload.comments as OperationsCaseComment[];
      })
      .then((nextComments) => {
        if (active) setComments(nextComments);
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(
            caught instanceof Error ? caught.message : "Comments unavailable.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [selectedCaseId]);

  function replaceFilters(
    patch: Partial<OperationsFilters>,
  ) {
    const next = {
      status: filter,
      sla: slaFilter,
      exception: exceptionFilter,
      provider: providerFilter,
      paymentMode: paymentModeFilter,
      priority: priorityFilter,
      owner: ownerFilter,
      age: ageFilter,
      query,
      caseId: selected?.id ?? initialFilters.caseId,
      ...patch,
    };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) {
      if (value && value !== "all") params.set(key, value);
    }
    router.replace(`/operations${params.size ? `?${params}` : ""}`, {
      scroll: false,
    });
  }

  function clearResolutionDraft() {
    setPendingResolution(false);
    setResolutionReason("");
    setEvidenceConfirmed(false);
  }

  function selectCase(paymentCase: OperationsCase | null) {
    setSelected(paymentCase);
    setComments([]);
    setCommentBody("");
    replaceFilters({ caseId: paymentCase?.id ?? null });
    clearResolutionDraft();
  }

  function toggleSelection(caseId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(caseId)) next.delete(caseId);
      else next.add(caseId);
      return next;
    });
  }

  async function assignSelected() {
    setBulkSaving(true);
    setError("");
    try {
      const response = await fetch("/api/cases/bulk", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          caseIds: [...selectedIds],
          owner: bulkOwner || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setCases((current) =>
        current.map((item) =>
          selectedIds.has(item.id)
            ? { ...item, owner: payload.owner, updatedAt: new Date().toISOString() }
            : item,
        ),
      );
      setSelected((current) =>
        current && selectedIds.has(current.id)
          ? { ...current, owner: payload.owner }
          : current,
      );
      setSelectedIds(new Set());
      setBulkOwner("");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Assignment failed.",
      );
    } finally {
      setBulkSaving(false);
    }
  }

  async function submitComment() {
    if (!selected || !commentBody.trim()) return;
    setCommentSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/cases/${selected.id}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: commentBody }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setComments((current) => [...current, payload.comment]);
      setCommentBody("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Comment failed.");
    } finally {
      setCommentSaving(false);
    }
  }

  async function updateSelected(patch: Partial<OperationsCase>) {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/cases/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: patch.status,
          priority: patch.priority,
          owner: Object.prototype.hasOwnProperty.call(patch, "owner")
            ? patch.owner
            : undefined,
          notes: patch.notes,
          resolutionReason: patch.resolutionReason,
          resolutionEvidenceConfirmed: patch.resolutionEvidenceConfirmed,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setSelected(payload.case);
      clearResolutionDraft();
      setCases((current) =>
        current.map((item) => (item.id === payload.case.id ? payload.case : item)),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Update failed.");
    } finally {
      setSaving(false);
    }
  }

  async function generateInvestigation() {
    if (!selected) return;
    setInvestigating(true);
    setError("");
    try {
      const response = await fetch(
        `/api/cases/${selected.id}/investigations`,
        { method: "POST" },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setSelected(payload.case);
      setCases((current) =>
        current.map((item) =>
          item.id === payload.case.id ? payload.case : item,
        ),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Investigation generation failed.",
      );
    } finally {
      setInvestigating(false);
    }
  }

  async function updateInvestigation(
    patch: {
      approvalStatus?: "pending" | "approved" | "rejected";
      feedbackRating?: "helpful" | "not_helpful";
      feedbackNotes?: string;
    },
  ) {
    const investigation = selected?.latestInvestigation;
    if (!investigation) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(
        `/api/investigations/${investigation.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setSelected(payload.case);
      setCases((current) =>
        current.map((item) =>
          item.id === payload.case.id ? payload.case : item,
        ),
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Feedback could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function copyProviderMessage() {
    const message = selected?.latestInvestigation?.providerMessage;
    if (!message) return;
    await navigator.clipboard.writeText(message);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return cases.filter(
      (item) => {
        const slaStatus = currentSlaStatus(item);
        const ageHours =
          (filterNow - new Date(item.createdAt).getTime()) / 3_600_000;
        const matchesAge =
          ageFilter === "all" ||
          (ageFilter === "under_4h" && ageHours < 4) ||
          (ageFilter === "4h_24h" && ageHours >= 4 && ageHours < 24) ||
          (ageFilter === "1d_3d" && ageHours >= 24 && ageHours < 72) ||
          (ageFilter === "over_3d" && ageHours >= 72);
        return (
          (filter === "all" || item.status === filter) &&
          (slaFilter === "all" || slaStatus === slaFilter) &&
          (exceptionFilter === "all" ||
            item.reconciliationStatus === exceptionFilter) &&
          (providerFilter === "all" || item.providerId === providerFilter) &&
          (paymentModeFilter === "all" ||
            item.paymentMode === paymentModeFilter) &&
          (priorityFilter === "all" || item.priority === priorityFilter) &&
          (ownerFilter === "all" ||
            (ownerFilter === "assigned" && Boolean(item.owner)) ||
            (ownerFilter === "unassigned" && !item.owner)) &&
          matchesAge &&
        (!normalized ||
          item.orderId.toLowerCase().includes(normalized) ||
          item.owner?.toLowerCase().includes(normalized) ||
            item.summary.toLowerCase().includes(normalized))
        );
      },
    );
  }, [
    ageFilter,
    cases,
    exceptionFilter,
    filterNow,
    filter,
    ownerFilter,
    paymentModeFilter,
    priorityFilter,
    providerFilter,
    query,
    slaFilter,
  ]);

  const advancedFilters = [
    exceptionFilter !== "all"
      ? ["exception", exceptionFilter, () => {
          setExceptionFilter("all");
          replaceFilters({ exception: "all" });
        }]
      : null,
    providerFilter !== "all"
      ? ["provider", providerFilter, () => {
          setProviderFilter("all");
          replaceFilters({ provider: "all" });
        }]
      : null,
    paymentModeFilter !== "all"
      ? ["payment mode", paymentModeFilter, () => {
          setPaymentModeFilter("all");
          replaceFilters({ paymentMode: "all" });
        }]
      : null,
    priorityFilter !== "all"
      ? ["priority", priorityFilter, () => {
          setPriorityFilter("all");
          replaceFilters({ priority: "all" });
        }]
      : null,
    ownerFilter !== "all"
      ? ["owner", ownerFilter, () => {
          setOwnerFilter("all");
          replaceFilters({ owner: "all" });
        }]
      : null,
    ageFilter !== "all"
      ? ["age", ageFilter.replaceAll("_", " "), () => {
          setAgeFilter("all");
          replaceFilters({ age: "all" });
        }]
      : null,
  ].filter(Boolean) as Array<[string, string, () => void]>;

  const slaCounts = cases.reduce(
    (counts, item) => {
      const status = currentSlaStatus(item);
      if (status === "at_risk") counts.atRisk += 1;
      if (status === "overdue") counts.overdue += 1;
      if (status === "breached") counts.breached += 1;
      return counts;
    },
    { atRisk: 0, overdue: 0, breached: 0 },
  );
  const counts = {
    active: cases.filter((item) => item.status !== "resolved").length,
    resolved: cases.filter((item) => item.status === "resolved").length,
  };

  return (
    <>
      <section className="workspace-hero compact-hero">
        <div>
          <p className="kicker">
            <span>OPERATIONS INBOX</span>
            <span>LIVE QUEUE</span>
          </p>
          <h1>Turn exceptions into accountable work.</h1>
          <p>
            Assign owners, capture investigation notes, and move every payment
            discrepancy toward a documented resolution.
          </p>
        </div>
        <div className="queue-stats">
          <div>
            <strong>{counts.active}</strong>
            <span>ACTIVE</span>
          </div>
          <div>
            <strong>{slaCounts.atRisk}</strong>
            <span>AT RISK</span>
          </div>
          <div className={slaCounts.overdue ? "urgent" : ""}>
            <strong>{slaCounts.overdue}</strong>
            <span>OVERDUE</span>
          </div>
          <div>
            <strong>{counts.resolved}</strong>
            <span>RESOLVED</span>
          </div>
        </div>
      </section>

      {(slaCounts.overdue > 0 || slaCounts.atRisk > 0) && (
        <section className="sla-alert" aria-label="SLA notification">
          <BellRing size={19} />
          <div>
            <strong>Attention needed</strong>
            <p>
              {slaCounts.overdue} overdue and {slaCounts.atRisk} at-risk{" "}
              {slaCounts.overdue + slaCounts.atRisk === 1 ? "case" : "cases"}.
              The queue is ordered to help the team act before more deadlines
              are missed.
            </p>
          </div>
          {slaCounts.overdue > 0 && (
            <button
              onClick={() => {
                setFilter("all");
                setSlaFilter("overdue");
                replaceFilters({ status: "all", sla: "overdue" });
              }}
            >
              Review overdue
            </button>
          )}
        </section>
      )}

      {advancedFilters.length > 0 && (
        <section className="operations-filter-context">
          <span>INSIGHTS DRILL-DOWN</span>
          <div>
            {advancedFilters.map(([label, value, clear]) => (
              <button key={label} onClick={clear}>
                {label}: <strong>{value}</strong> <X size={11} />
              </button>
            ))}
            <button
              className="clear-all"
              onClick={() => {
                setExceptionFilter("all");
                setProviderFilter("all");
                setPaymentModeFilter("all");
                setPriorityFilter("all");
                setOwnerFilter("all");
                setAgeFilter("all");
                router.replace("/operations", { scroll: false });
              }}
            >
              Clear all
            </button>
          </div>
        </section>
      )}

      {canEdit && selectedIds.size > 0 && (
        <section className="case-dispatch-rail" aria-label="Bulk assignment">
          <div>
            <span>DISPATCH SELECTION</span>
            <strong>{selectedIds.size} cases marked</strong>
          </div>
          <input
            value={bulkOwner}
            onChange={(event) => setBulkOwner(event.target.value)}
            placeholder="Owner name, blank to unassign"
            maxLength={120}
          />
          <button disabled={bulkSaving} onClick={assignSelected}>
            {bulkSaving ? "Assigning…" : bulkOwner ? "Assign owner" : "Unassign"}
          </button>
          <button
            className="dispatch-clear"
            onClick={() => setSelectedIds(new Set())}
          >
            Clear
          </button>
        </section>
      )}

      <section className="operations-layout">
        <CaseQueue
          filter={filter}
          slaFilter={slaFilter}
          query={query}
          error={error}
          loading={loading}
          visible={visible}
          selectedId={selected?.id ?? null}
          selectedIds={selectedIds}
          canEdit={canEdit}
          onFilterChange={(value) => {
            setFilter(value);
            replaceFilters({ status: value });
          }}
          onSlaFilterChange={(value) => {
            setSlaFilter(value);
            replaceFilters({ sla: value });
          }}
          onQueryChange={(value) => {
            setQuery(value);
            replaceFilters({ query: value });
          }}
          onSelect={selectCase}
          onToggleSelection={toggleSelection}
          getSlaStatus={currentSlaStatus}
          formatDateTime={formatDateTime}
          formatSlaDistance={formatSlaDistance}
          formatMoney={formatMoney}
        />

        <aside className="case-detail-panel">
          {selected ? (
            <>
              <button
                className="mobile-close"
                onClick={() => selectCase(null)}
                aria-label="Close case"
              >
                <X size={18} />
              </button>
              <p className="eyebrow">CASE DETAIL</p>
              <div className="case-title-row">
                <div>
                  <h2>{selected.orderId}</h2>
                  <span>{selected.runName}</span>
                </div>
                <span className={`priority-chip ${selected.priority}`}>
                  {selected.priority}
                </span>
              </div>
              <p className="case-summary">{selected.summary}</p>

              <div
                className={`sla-control ${currentSlaStatus(selected)}`}
                aria-label="Case SLA status"
              >
                <div>
                  <Clock3 size={18} />
                  <span>SLA CONTROL</span>
                </div>
                <strong>{slaLabels[currentSlaStatus(selected)]}</strong>
                <p>
                  {selected.status === "resolved"
                    ? `Resolved ${formatDateTime(selected.resolvedAt!)}`
                    : formatSlaDistance(selected.dueAt)}
                </p>
                <dl>
                  <div>
                    <dt>Target</dt>
                    <dd>{SLA_HOURS[selected.priority]} hours</dd>
                  </div>
                  <div>
                    <dt>Deadline</dt>
                    <dd>{formatDateTime(selected.dueAt)}</dd>
                  </div>
                </dl>
              </div>

              <div className="case-form">
                <label>
                  STATUS
                  <select
                    value={selected.status}
                    disabled={saving || !canEdit}
                    onChange={(event) => {
                      const status = event.target.value as CaseStatus;
                      if (status === "resolved") {
                        setPendingResolution(true);
                        return;
                      }
                      updateSelected({ status });
                    }}
                  >
                    <option value="open">Open</option>
                    <option value="investigating">Investigating</option>
                    <option value="resolved">Resolved</option>
                  </select>
                </label>
                <label>
                  OWNER
                  <input
                    key={`${selected.id}-${selected.owner}`}
                    defaultValue={selected.owner ?? ""}
                    placeholder="Assign an analyst"
                    disabled={!canEdit}
                    onBlur={(event) =>
                      updateSelected({ owner: event.target.value || null })
                    }
                  />
                </label>
                <label>
                  PRIORITY
                  <select
                    value={selected.priority}
                    disabled={saving || !canEdit}
                    onChange={(event) =>
                      updateSelected({
                        priority: event.target
                          .value as OperationsCase["priority"],
                      })
                    }
                  >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </label>
                <label className="notes-field">
                  INVESTIGATION NOTES
                  <textarea
                    key={`${selected.id}-${selected.notes}`}
                    defaultValue={selected.notes}
                    placeholder="Record what you checked and what happened…"
                    disabled={!canEdit}
                    onBlur={(event) =>
                      updateSelected({ notes: event.target.value })
                    }
                  />
                </label>
              </div>

              {pendingResolution && selected.status !== "resolved" && (
                <CaseResolutionControl
                  saving={saving}
                  reason={resolutionReason}
                  evidenceConfirmed={evidenceConfirmed}
                  onReasonChange={setResolutionReason}
                  onEvidenceConfirmedChange={setEvidenceConfirmed}
                  onCancel={() => setPendingResolution(false)}
                  onResolve={() =>
                    updateSelected({
                      status: "resolved",
                      resolutionReason,
                      resolutionEvidenceConfirmed: evidenceConfirmed,
                    })
                  }
                />
              )}

              {selected.status === "resolved" && (
                <CaseResolutionRecord
                  reason={selected.resolutionReason}
                  resolvedByName={selected.resolvedByName}
                  resolvedAt={selected.resolvedAt!}
                  formatDateTime={formatDateTime}
                />
              )}

              <div className="case-evidence">
                <p>EVIDENCE</p>
                {selected.evidence.map((line) => (
                  <div key={line}>
                    <AlertTriangle size={15} />
                    <span>{line}</span>
                  </div>
                ))}
              </div>

              <SourceEvidenceLedger
                evidence={selected.sourceEvidence}
                emptyMessage="Historical case created before source-row persistence."
              />

              <ProviderEventTimeline
                events={selected.providerEvents}
                emptyMessage="No synthetic provider event matched this case."
                formatDateTime={formatDateTime}
              />

              <section className="case-comment-ledger">
                <header>
                  <div>
                    <p className="eyebrow">INTERNAL HANDOFF LOG</p>
                    <h3>Operational comments</h3>
                  </div>
                  <span>{comments.length} entries</span>
                </header>
                <div className="case-comment-list">
                  {comments.length ? (
                    comments.map((comment) => (
                      <article key={comment.id}>
                        <div>
                          <strong>{comment.authorName}</strong>
                          <time>{formatDateTime(comment.createdAt)}</time>
                        </div>
                        <p>{comment.body}</p>
                      </article>
                    ))
                  ) : (
                    <p className="case-comment-empty">
                      No handoff notes yet. Comments are attributed and
                      append-only.
                    </p>
                  )}
                </div>
                {canEdit && (
                  <div className="case-comment-compose">
                    <MessageSquareText size={17} />
                    <textarea
                      value={commentBody}
                      onChange={(event) => setCommentBody(event.target.value)}
                      placeholder="Add a concise operational handoff…"
                      maxLength={2000}
                    />
                    <button
                      disabled={commentSaving || !commentBody.trim()}
                      onClick={submitComment}
                    >
                      {commentSaving ? "Adding…" : "Add comment"}
                    </button>
                  </div>
                )}
              </section>

              <section className="ai-investigation">
                <div className="ai-investigation-head">
                  <div>
                    <p className="eyebrow">AI INVESTIGATION</p>
                    <h3>Evidence-grounded assistant</h3>
                  </div>
                  <span>
                    <ShieldCheck size={14} />
                    Human approval required
                  </span>
                </div>

                {selected.latestInvestigation ? (
                  <div className="investigation-result">
                    <div className="investigation-meta">
                      <span
                        className={`confidence ${selected.latestInvestigation.confidence}`}
                      >
                        {selected.latestInvestigation.confidence} confidence
                      </span>
                      <span>
                        {selected.latestInvestigation.provider === "openai"
                          ? selected.latestInvestigation.model
                          : "Evidence rules · demo mode"}
                      </span>
                      <span
                        className={`approval ${selected.latestInvestigation.approvalStatus}`}
                      >
                        {selected.latestInvestigation.approvalStatus}
                      </span>
                    </div>

                    <div className="investigation-block">
                      <span>LIKELY CAUSE</span>
                      <p>{selected.latestInvestigation.likelyCause}</p>
                    </div>

                    <div className="investigation-block">
                      <span>RECOMMENDED ACTIONS</span>
                      <ol>
                        {selected.latestInvestigation.recommendedActions.map(
                          (action) => (
                            <li key={action}>{action}</li>
                          ),
                        )}
                      </ol>
                    </div>

                    <div className="investigation-block provider-draft">
                      <div>
                        <span>DRAFT PROVIDER MESSAGE</span>
                        <button onClick={copyProviderMessage}>
                          <Copy size={13} />
                          {copied ? "Copied" : "Copy"}
                        </button>
                      </div>
                      <pre>{selected.latestInvestigation.providerMessage}</pre>
                    </div>

                    <div className="limitations">
                      <strong>What this analysis cannot confirm</strong>
                      {selected.latestInvestigation.limitations.map(
                        (limitation) => (
                          <p key={limitation}>{limitation}</p>
                        ),
                      )}
                    </div>

                    <div className="approval-actions">
                      <button
                        className="approve-button"
                        disabled={saving || !canEdit}
                        onClick={() =>
                          updateInvestigation({
                            approvalStatus: "approved",
                          })
                        }
                      >
                        <CheckCircle2 size={15} /> Approve analysis
                      </button>
                      <button
                        disabled={saving || !canEdit}
                        onClick={() =>
                          updateInvestigation({
                            approvalStatus: "rejected",
                          })
                        }
                      >
                        Reject
                      </button>
                      <button
                        disabled={investigating || !canEdit}
                        onClick={generateInvestigation}
                      >
                        Regenerate
                      </button>
                    </div>

                    <div className="feedback-box">
                      <span>WAS THIS USEFUL?</span>
                      <button
                        disabled={!canEdit}
                        className={
                          selected.latestInvestigation.feedbackRating ===
                          "helpful"
                            ? "active"
                            : ""
                        }
                        onClick={() =>
                          updateInvestigation({
                            feedbackRating: "helpful",
                          })
                        }
                      >
                        <ThumbsUp size={14} /> Yes
                      </button>
                      <button
                        disabled={!canEdit}
                        className={
                          selected.latestInvestigation.feedbackRating ===
                          "not_helpful"
                            ? "active"
                            : ""
                        }
                        onClick={() =>
                          updateInvestigation({
                            feedbackRating: "not_helpful",
                          })
                        }
                      >
                        <ThumbsDown size={14} /> No
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="investigation-empty">
                    <Sparkles size={26} />
                    <p>
                      Analyze the selected evidence, suggest next steps, and
                      draft a provider message. Nothing is sent automatically.
                    </p>
                    <button
                      className="primary-button"
                      disabled={investigating || !canEdit}
                      onClick={generateInvestigation}
                    >
                      {investigating ? (
                        <LoaderCircle className="spin" size={17} />
                      ) : (
                        <Sparkles size={17} />
                      )}
                      {!canEdit
                        ? "Viewer access · read only"
                        : investigating
                        ? "Investigating…"
                        : "Investigate with AI"}
                    </button>
                  </div>
                )}
              </section>
              {saving && (
                <div className="saving-indicator">
                  <LoaderCircle className="spin" size={15} /> Saving…
                </div>
              )}
            </>
          ) : (
            <div className="detail-placeholder">
              <CircleDot size={32} />
              <h2>Select a case</h2>
              <p>Choose an exception to assign and investigate it.</p>
            </div>
          )}
        </aside>
      </section>
    </>
  );
}
