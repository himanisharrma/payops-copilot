"use client";

import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  Clock3,
  LoaderCircle,
  UserRound,
} from "lucide-react";
import { OpsSearchField } from "@/components/ui/ops-search-field";
import type { CaseStatus, OperationsCase, SlaStatus } from "@/lib/types";

const settlementLabels: Record<OperationsCase["settlementStatus"], string> = {
  not_due: "Not due",
  due_today: "Due today",
  overdue: "Settlement overdue",
  settled: "Settled",
  timing_unavailable: "Timing unavailable",
};

export const caseStatusLabels: Record<CaseStatus, string> = {
  open: "Open",
  investigating: "Investigating",
  resolved: "Resolved",
};

export const caseSlaLabels: Record<SlaStatus, string> = {
  on_track: "On track",
  at_risk: "At risk",
  overdue: "Overdue",
  met: "SLA met",
  breached: "SLA breached",
};

export function CaseQueue({
  filter,
  slaFilter,
  query,
  error,
  loading,
  visible,
  selectedId,
  selectedIds,
  canEdit,
  onFilterChange,
  onSlaFilterChange,
  onQueryChange,
  onSelect,
  onToggleSelection,
  getSlaStatus,
  formatDateTime,
  formatSlaDistance,
  formatMoney,
}: {
  filter: "all" | CaseStatus;
  slaFilter: "all" | "at_risk" | "overdue";
  query: string;
  error: string;
  loading: boolean;
  visible: OperationsCase[];
  selectedId: string | null;
  selectedIds: Set<string>;
  canEdit: boolean;
  onFilterChange: (value: "all" | CaseStatus) => void;
  onSlaFilterChange: (value: "all" | "at_risk" | "overdue") => void;
  onQueryChange: (value: string) => void;
  onSelect: (paymentCase: OperationsCase) => void;
  onToggleSelection: (caseId: string) => void;
  getSlaStatus: (paymentCase: OperationsCase) => SlaStatus;
  formatDateTime: (value: string) => string;
  formatSlaDistance: (value: string) => string;
  formatMoney: (value: number) => string;
}) {
  return (
    <div className="case-list-panel">
      <div className="case-toolbar">
        <div className="case-filter-stack">
          <div className="filter-group">
            {(["all", "open", "investigating", "resolved"] as const).map(
              (value) => (
                <button
                  key={value}
                  className={filter === value ? "active" : ""}
                  onClick={() => onFilterChange(value)}
                >
                  {value === "all" ? "All" : caseStatusLabels[value]}
                </button>
              ),
            )}
          </div>
          <div className="filter-group sla-filter-group">
            {(["all", "at_risk", "overdue"] as const).map((value) => (
              <button
                key={value}
                className={slaFilter === value ? "active" : ""}
                onClick={() => onSlaFilterChange(value)}
              >
                {value === "all"
                  ? "Any SLA"
                  : value === "at_risk"
                    ? "At risk"
                    : "Overdue"}
              </button>
            ))}
          </div>
        </div>
        <OpsSearchField
          label="Search cases"
          value={query}
          onChange={onQueryChange}
          placeholder="Search order, owner or issue"
        />
      </div>

      {error && <div className="error-banner">{error}</div>}
      {loading ? (
        <div className="loading-state">
          <LoaderCircle className="spin" />
          Loading PostgreSQL cases…
        </div>
      ) : visible.length ? (
        <div className="case-list">
          {visible.map((item) => {
            const slaStatus = getSlaStatus(item);
            return (
              <article
                key={item.id}
                className={`case-card ${
                  selectedId === item.id ? "selected" : ""
                } ${selectedIds.has(item.id) ? "batch-selected" : ""}`}
              >
                {canEdit && (
                  <label className="case-select-control">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={() => onToggleSelection(item.id)}
                    />
                    <span>Select</span>
                  </label>
                )}
                <button
                  className="case-card-open"
                  onClick={() => onSelect(item)}
                  aria-label={`Open case ${item.orderId}`}
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
                    {caseStatusLabels[item.status]}
                  </span>
                </div>
                <h2>{item.orderId}</h2>
                <p>{item.summary}</p>
                {(item.caseOrigin === "settlement_overdue" ||
                  item.reconciliationStatus === "missing_settlement") && (
                  <div
                    className={`settlement-card-status ${item.settlementStatus}`}
                  >
                    <CalendarClock size={13} />
                    <strong>{settlementLabels[item.settlementStatus]}</strong>
                    <span>
                      {item.settlementCycle
                        ? `${item.settlementCycle} cycle`
                        : "No timing basis"}
                    </span>
                  </div>
                )}
                <div className={`sla-card-status ${slaStatus}`}>
                  <Clock3 size={13} />
                  <strong>{caseSlaLabels[slaStatus]}</strong>
                  <span>
                    {item.status === "resolved"
                      ? `Resolved ${formatDateTime(item.resolvedAt!)}`
                      : formatSlaDistance(item.dueAt)}
                  </span>
                </div>
                <div className="case-card-meta">
                  <span>
                    <UserRound size={13} />
                    {item.owner || "Unassigned"}
                  </span>
                  <strong>{formatMoney(Math.abs(item.variance))}</strong>
                  <ArrowRight size={15} />
                </div>
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="loading-state">
          <CheckCircle2 />
          No cases match this view.
        </div>
      )}
    </div>
  );
}
