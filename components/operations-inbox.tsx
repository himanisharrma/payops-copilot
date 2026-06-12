"use client";

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Copy,
  LoaderCircle,
  Search,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CaseStatus, OperationsCase } from "@/lib/types";

const statusLabels: Record<CaseStatus, string> = {
  open: "Open",
  investigating: "Investigating",
  resolved: "Resolved",
};

const formatMoney = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);

export function OperationsInbox() {
  const [cases, setCases] = useState<OperationsCase[]>([]);
  const [selected, setSelected] = useState<OperationsCase | null>(null);
  const [filter, setFilter] = useState<"all" | CaseStatus>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [investigating, setInvestigating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/cases")
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        return payload.cases as OperationsCase[];
      })
      .then((loadedCases) => {
        if (active) setCases(loadedCases);
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
  }, []);

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
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setSelected(payload.case);
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
      (item) =>
        (filter === "all" || item.status === filter) &&
        (!normalized ||
          item.orderId.toLowerCase().includes(normalized) ||
          item.owner?.toLowerCase().includes(normalized) ||
          item.summary.toLowerCase().includes(normalized)),
    );
  }, [cases, filter, query]);

  const counts = {
    open: cases.filter((item) => item.status === "open").length,
    investigating: cases.filter((item) => item.status === "investigating").length,
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
            <strong>{counts.open}</strong>
            <span>OPEN</span>
          </div>
          <div>
            <strong>{counts.investigating}</strong>
            <span>IN REVIEW</span>
          </div>
          <div>
            <strong>{counts.resolved}</strong>
            <span>RESOLVED</span>
          </div>
        </div>
      </section>

      <section className="operations-layout">
        <div className="case-list-panel">
          <div className="case-toolbar">
            <div className="filter-group">
              {(["all", "open", "investigating", "resolved"] as const).map(
                (value) => (
                  <button
                    key={value}
                    className={filter === value ? "active" : ""}
                    onClick={() => setFilter(value)}
                  >
                    {value === "all" ? "All" : statusLabels[value]}
                  </button>
                ),
              )}
            </div>
            <label className="search-box">
              <Search size={16} />
              <span className="sr-only">Search cases</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search order, owner or issue"
              />
            </label>
          </div>

          {error && <div className="error-banner">{error}</div>}
          {loading ? (
            <div className="loading-state">
              <LoaderCircle className="spin" />
              Loading PostgreSQL cases…
            </div>
          ) : visible.length ? (
            <div className="case-list">
              {visible.map((item) => (
                <button
                  key={item.id}
                  className={`case-card ${
                    selected?.id === item.id ? "selected" : ""
                  }`}
                  onClick={() => setSelected(item)}
                >
                  <div className="case-card-top">
                    <span className={`priority-chip ${item.priority}`}>
                      {item.priority} priority
                    </span>
                    <span className={`case-status ${item.status}`}>
                      {item.status === "resolved" ? (
                        <CheckCircle2 size={13} />
                      ) : (
                        <CircleDot size={13} />
                      )}
                      {statusLabels[item.status]}
                    </span>
                  </div>
                  <h2>{item.orderId}</h2>
                  <p>{item.summary}</p>
                  <div className="case-card-meta">
                    <span>
                      <UserRound size={13} />
                      {item.owner || "Unassigned"}
                    </span>
                    <strong>{formatMoney(Math.abs(item.variance))}</strong>
                    <ArrowRight size={15} />
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="loading-state">
              <CheckCircle2 />
              No cases match this view.
            </div>
          )}
        </div>

        <aside className="case-detail-panel">
          {selected ? (
            <>
              <button
                className="mobile-close"
                onClick={() => setSelected(null)}
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

              <div className="case-form">
                <label>
                  STATUS
                  <select
                    value={selected.status}
                    disabled={saving}
                    onChange={(event) =>
                      updateSelected({
                        status: event.target.value as CaseStatus,
                      })
                    }
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
                    onBlur={(event) =>
                      updateSelected({ owner: event.target.value || null })
                    }
                  />
                </label>
                <label>
                  PRIORITY
                  <select
                    value={selected.priority}
                    disabled={saving}
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
                    onBlur={(event) =>
                      updateSelected({ notes: event.target.value })
                    }
                  />
                </label>
              </div>

              <div className="case-evidence">
                <p>EVIDENCE</p>
                {selected.evidence.map((line) => (
                  <div key={line}>
                    <AlertTriangle size={15} />
                    <span>{line}</span>
                  </div>
                ))}
              </div>

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
                        disabled={saving}
                        onClick={() =>
                          updateInvestigation({
                            approvalStatus: "approved",
                          })
                        }
                      >
                        <CheckCircle2 size={15} /> Approve analysis
                      </button>
                      <button
                        disabled={saving}
                        onClick={() =>
                          updateInvestigation({
                            approvalStatus: "rejected",
                          })
                        }
                      >
                        Reject
                      </button>
                      <button
                        disabled={investigating}
                        onClick={generateInvestigation}
                      >
                        Regenerate
                      </button>
                    </div>

                    <div className="feedback-box">
                      <span>WAS THIS USEFUL?</span>
                      <button
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
                      disabled={investigating}
                      onClick={generateInvestigation}
                    >
                      {investigating ? (
                        <LoaderCircle className="spin" size={17} />
                      ) : (
                        <Sparkles size={17} />
                      )}
                      {investigating
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
