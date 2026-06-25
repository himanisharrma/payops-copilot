"use client";

import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  FileCheck2,
  LoaderCircle,
  RotateCcw,
  ShieldAlert,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { OpsSearchField } from "@/components/ui/ops-search-field";
import { ProviderEventTimeline } from "@/components/ui/provider-event-timeline";
import {
  checklistProgress,
  terminalWorkflowStatuses,
  workflowDeadlineState,
  workflowTransitions,
} from "@/lib/payment-workflow";
import type {
  EvidenceChecklistItem,
  PaymentWorkflow,
  PaymentWorkflowStatus,
  PaymentWorkflowType,
} from "@/lib/types";

const statusLabels: Record<PaymentWorkflowStatus, string> = {
  requested: "Requested",
  approved: "Approved",
  processing: "Processing",
  completed: "Completed",
  rejected: "Rejected",
  received: "Received",
  evidence_due: "Evidence due",
  evidence_submitted: "Evidence submitted",
  won: "Won",
  lost: "Lost",
  accepted: "Accepted",
};

const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);

const dateTime = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));

function deadlineCopy(workflow: PaymentWorkflow) {
  const state = workflowDeadlineState(workflow);
  if (state === "closed") return `Closed ${dateTime(workflow.resolvedAt!)}`;
  const hours = Math.round(
    (new Date(workflow.dueAt).getTime() - Date.now()) / 3_600_000,
  );
  if (hours < 0) return `${Math.abs(hours)}h overdue`;
  if (hours === 0) return "Due within the hour";
  if (hours < 24) return `${hours}h remaining`;
  return `${Math.ceil(hours / 24)}d remaining`;
}

export function PaymentLifecycle({ canEdit }: { canEdit: boolean }) {
  const [workflows, setWorkflows] = useState<PaymentWorkflow[]>([]);
  const [selected, setSelected] = useState<PaymentWorkflow | null>(null);
  const [typeFilter, setTypeFilter] = useState<
    "all" | PaymentWorkflowType
  >("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/payment-workflows")
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        return payload.workflows as PaymentWorkflow[];
      })
      .then((items) => active && setWorkflows(items))
      .catch((caught: unknown) => {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Payment workflows unavailable.",
          );
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  async function updateWorkflow(
    patch: {
      status?: PaymentWorkflowStatus;
      priority?: PaymentWorkflow["priority"];
      owner?: string | null;
      notes?: string;
      evidenceChecklist?: EvidenceChecklistItem[];
    },
  ) {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/payment-workflows/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setSelected(payload.workflow);
      setWorkflows((current) =>
        current.map((workflow) =>
          workflow.id === payload.workflow.id ? payload.workflow : workflow,
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Update failed.");
    } finally {
      setSaving(false);
    }
  }

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return workflows.filter(
      (workflow) =>
        (typeFilter === "all" || workflow.type === typeFilter) &&
        (!normalized ||
          workflow.externalReference.toLowerCase().includes(normalized) ||
          workflow.orderId.toLowerCase().includes(normalized) ||
          workflow.reason.toLowerCase().includes(normalized) ||
          workflow.owner?.toLowerCase().includes(normalized)),
    );
  }, [query, typeFilter, workflows]);

  const active = workflows.filter(
    (workflow) => !terminalWorkflowStatuses.has(workflow.status),
  );
  const exposure = active.reduce(
    (total, workflow) => total + workflow.amount,
    0,
  );
  const dueSoon = active.filter((workflow) =>
    ["due_soon", "overdue"].includes(workflowDeadlineState(workflow)),
  ).length;
  const evidenceReady = active.filter(
    (workflow) => checklistProgress(workflow).percent === 100,
  ).length;

  return (
    <>
      <section className="workspace-hero compact-hero lifecycle-hero">
        <div>
          <p className="kicker">
            <span>REFUNDS + CHARGEBACKS</span>
            <span>SYNTHETIC OPERATIONS</span>
          </p>
          <h1>Control money movement before deadlines control you.</h1>
          <p>
            Track refund approvals and chargeback evidence as separate,
            accountable lifecycles. This workspace never moves money; it makes
            the decision trail visible.
          </p>
        </div>
        <div className="lifecycle-exposure">
          <span>ACTIVE EXPOSURE</span>
          <strong>{money(exposure)}</strong>
          <small>{active.length} open workflows</small>
        </div>
      </section>

      <section className="lifecycle-metrics">
        <article>
          <CircleDollarSign size={19} />
          <span>OPEN VALUE</span>
          <strong>{money(exposure)}</strong>
        </article>
        <article className={dueSoon ? "urgent" : ""}>
          <Clock3 size={19} />
          <span>DEADLINE RISK</span>
          <strong>{dueSoon}</strong>
        </article>
        <article>
          <FileCheck2 size={19} />
          <span>EVIDENCE READY</span>
          <strong>{evidenceReady}</strong>
        </article>
        <article>
          <CheckCircle2 size={19} />
          <span>CLOSED</span>
          <strong>{workflows.length - active.length}</strong>
        </article>
      </section>

      <section className="lifecycle-layout">
        <div className="lifecycle-queue">
          <div className="lifecycle-toolbar">
            <div className="filter-group">
              {(["all", "refund", "chargeback"] as const).map((type) => (
                <button
                  key={type}
                  className={typeFilter === type ? "active" : ""}
                  onClick={() => setTypeFilter(type)}
                >
                  {type === "all"
                    ? "All"
                    : type === "refund"
                      ? "Refunds"
                      : "Chargebacks"}
                </button>
              ))}
            </div>
            <OpsSearchField
              label="Search payment workflows"
              value={query}
              onChange={setQuery}
              placeholder="Search reference, order or owner"
              iconSize={15}
            />
          </div>

          {error && <div className="error-banner">{error}</div>}
          {loading ? (
            <div className="loading-state">
              <LoaderCircle className="spin" />
              Loading refund and chargeback records...
            </div>
          ) : visible.length ? (
            <div className="lifecycle-list">
              {visible.map((workflow) => {
                const progress = checklistProgress(workflow);
                const deadline = workflowDeadlineState(workflow);
                return (
                  <button
                    key={workflow.id}
                    className={`lifecycle-card ${selected?.id === workflow.id ? "selected" : ""}`}
                    onClick={() => setSelected(workflow)}
                  >
                    <div className="lifecycle-card-head">
                      <span className={`workflow-type ${workflow.type}`}>
                        {workflow.type === "refund" ? (
                          <RotateCcw size={13} />
                        ) : (
                          <ShieldAlert size={13} />
                        )}
                        {workflow.type}
                      </span>
                      <span className={`deadline-state ${deadline}`}>
                        {deadlineCopy(workflow)}
                      </span>
                    </div>
                    <div className="lifecycle-reference">
                      <div>
                        <strong>{workflow.externalReference}</strong>
                        <span>{workflow.orderId}</span>
                      </div>
                      <b>{money(workflow.amount)}</b>
                    </div>
                    <p>{workflow.reason}</p>
                    <div className="evidence-progress">
                      <div>
                        <span style={{ width: `${progress.percent}%` }} />
                      </div>
                      <small>
                        {progress.complete}/{progress.total} evidence checks
                      </small>
                    </div>
                    <div className="lifecycle-card-foot">
                      <span>
                        <UserRound size={13} />
                        {workflow.owner || "Unassigned"}
                      </span>
                      <strong>{statusLabels[workflow.status]}</strong>
                      <ArrowRight size={14} />
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="loading-state">No workflows match this view.</div>
          )}
        </div>

        <aside className="lifecycle-detail">
          {selected ? (
            <>
              <button
                className="mobile-close"
                onClick={() => setSelected(null)}
                aria-label="Close workflow detail"
              >
                <X size={18} />
              </button>
              <div className="lifecycle-detail-heading">
                <div>
                  <span className={`workflow-type ${selected.type}`}>
                    {selected.type}
                  </span>
                  <h2>{selected.externalReference}</h2>
                  <p>
                    {selected.orderId} · {selected.paymentReference}
                  </p>
                </div>
                <strong>{money(selected.amount)}</strong>
              </div>

              <div className={`deadline-rail ${workflowDeadlineState(selected)}`}>
                <Clock3 size={18} />
                <div>
                  <span>EVIDENCE DEADLINE</span>
                  <strong>{deadlineCopy(selected)}</strong>
                </div>
                <time>{dateTime(selected.dueAt)}</time>
              </div>

              <p className="lifecycle-reason">{selected.reason}</p>

              <div className="lifecycle-form">
                <label>
                  LIFECYCLE STAGE
                  <select
                    value={selected.status}
                    disabled={!canEdit || saving}
                    onChange={(event) =>
                      updateWorkflow({
                        status: event.target.value as PaymentWorkflowStatus,
                      })
                    }
                  >
                    {[
                      selected.status,
                      ...workflowTransitions[selected.status],
                    ].map((status) => (
                      <option
                        key={status}
                        value={status}
                        disabled={
                          status === "evidence_submitted" &&
                          checklistProgress(selected).percent < 100
                        }
                      >
                        {statusLabels[status]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  OWNER
                  <input
                    key={`${selected.id}-${selected.owner}`}
                    defaultValue={selected.owner ?? ""}
                    disabled={!canEdit}
                    placeholder="Assign an analyst"
                    onBlur={(event) =>
                      updateWorkflow({ owner: event.target.value || null })
                    }
                  />
                </label>
                <label>
                  PRIORITY
                  <select
                    value={selected.priority}
                    disabled={!canEdit || saving}
                    onChange={(event) =>
                      updateWorkflow({
                        priority: event.target
                          .value as PaymentWorkflow["priority"],
                      })
                    }
                  >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </label>
              </div>

              <section className="workflow-evidence">
                <div>
                  <span>EVIDENCE CHECKLIST</span>
                  <strong>
                    {checklistProgress(selected).percent}% complete
                  </strong>
                </div>
                {selected.evidenceChecklist.map((item) => (
                  <label key={item.key}>
                    <input
                      type="checkbox"
                      checked={item.complete}
                      disabled={!canEdit || saving}
                      onChange={() =>
                        updateWorkflow({
                          evidenceChecklist: selected.evidenceChecklist.map(
                            (evidence) =>
                              evidence.key === item.key
                                ? {
                                    ...evidence,
                                    complete: !evidence.complete,
                                  }
                                : evidence,
                          ),
                        })
                      }
                    />
                    <span className={item.complete ? "complete" : ""}>
                      <i>{item.complete && <Check size={13} />}</i>
                      {item.label}
                    </span>
                  </label>
                ))}
              </section>

              <label className="workflow-notes">
                OPERATIONS NOTES
                <textarea
                  key={`${selected.id}-${selected.notes}`}
                  defaultValue={selected.notes}
                  disabled={!canEdit}
                  placeholder="Record the decision, missing evidence, or provider response."
                  onBlur={(event) =>
                    updateWorkflow({ notes: event.target.value })
                  }
                />
              </label>

              <ProviderEventTimeline
                events={selected.providerEvents}
                emptyMessage="No synthetic provider event matched this workflow."
                formatDateTime={dateTime}
                preferReference="external"
              />

              <section className="workflow-timeline">
                <div className="timeline-heading">
                  <span>DECISION TIMELINE</span>
                  <small>{selected.events.length} events</small>
                </div>
                {selected.events.map((event) => (
                  <article key={event.id}>
                    <i />
                    <div>
                      <strong>{event.title}</strong>
                      <p>{event.detail}</p>
                      <small>
                        {event.actorName} · {dateTime(event.createdAt)}
                      </small>
                    </div>
                  </article>
                ))}
              </section>

              {!canEdit && (
                <div className="viewer-notice">
                  <AlertTriangle size={16} />
                  Viewer access is read only.
                </div>
              )}
              {saving && (
                <div className="saving-indicator">
                  <LoaderCircle className="spin" size={15} /> Saving...
                </div>
              )}
            </>
          ) : (
            <div className="detail-placeholder">
              <ShieldAlert size={32} />
              <h2>Select a workflow</h2>
              <p>
                Open a refund or chargeback to inspect its deadline, evidence,
                ownership, and decision history.
              </p>
            </div>
          )}
        </aside>
      </section>
    </>
  );
}
