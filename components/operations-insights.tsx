"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CircleGauge,
  DatabaseZap,
  Banknote,
  GitBranch,
  ShieldCheck,
} from "lucide-react";
import { operationsDrilldown } from "@/lib/insights";
import { providerName } from "@/lib/provider-webhooks";
import type {
  InsightsDashboard,
  InsightsMetric,
  ReconciliationStatus,
} from "@/lib/types";

const exceptionLabels: Record<ReconciliationStatus, string> = {
  matched: "Matched",
  amount_mismatch: "Amount mismatch",
  missing_settlement: "Missing settlement",
  gateway_missing: "Gateway missing",
  duplicate: "Duplicate",
  pending: "Pending",
};

const agingLabels = {
  under_4h: "Under 4h",
  "4h_24h": "4–24h",
  "1d_3d": "1–3d",
  over_3d: "Over 3d",
};

const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

const shortDate = (value: string) =>
  new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
  });

function MetricDelta({
  metric,
  invert = false,
}: {
  metric: InsightsMetric;
  invert?: boolean;
}) {
  if (metric.changePercent === null) {
    return <span className="insights-delta neutral">No comparison</span>;
  }
  const improved = invert
    ? metric.changePercent <= 0
    : metric.changePercent >= 0;
  return (
    <span className={`insights-delta ${improved ? "positive" : "negative"}`}>
      {metric.changePercent >= 0 ? (
        <ArrowUpRight size={12} />
      ) : (
        <ArrowDownRight size={12} />
      )}
      {Math.abs(metric.changePercent)}% vs prior
    </span>
  );
}

function DailyTrend({
  data,
}: {
  data: InsightsDashboard["dailyTrend"];
}) {
  const width = 760;
  const height = 220;
  const inset = 24;
  const max = Math.max(
    1,
    ...data.flatMap((point) => [
      point.orders,
      point.exceptions,
      point.resolved,
    ]),
  );
  const points = (
    key: "orders" | "exceptions" | "resolved",
  ) =>
    data
      .map((point, index) => {
        const x =
          inset +
          (index / Math.max(1, data.length - 1)) * (width - inset * 2);
        const y =
          height -
          inset -
          (point[key] / max) * (height - inset * 2);
        return `${x},${y}`;
      })
      .join(" ");
  return (
    <div className="insights-trend">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Daily orders, exceptions, and resolved cases"
      >
        {[0.25, 0.5, 0.75].map((ratio) => (
          <line
            key={ratio}
            x1={inset}
            x2={width - inset}
            y1={height * ratio}
            y2={height * ratio}
          />
        ))}
        <polyline className="trend-orders" points={points("orders")} />
        <polyline
          className="trend-exceptions"
          points={points("exceptions")}
        />
        <polyline className="trend-resolved" points={points("resolved")} />
      </svg>
      <div className="trend-legend">
        <span><i className="orders" /> Orders</span>
        <span><i className="exceptions" /> Exceptions</span>
        <span><i className="resolved" /> Resolved</span>
      </div>
    </div>
  );
}

export function OperationsInsights({
  dashboard,
}: {
  dashboard: InsightsDashboard;
}) {
  const router = useRouter();
  function setFilter(key: string, value: string) {
    const params = new URLSearchParams();
    const next = { ...dashboard.filters, [key]: value };
    for (const [filterKey, filterValue] of Object.entries(next)) {
      if (filterValue !== "all" && filterValue !== "30d") {
        params.set(filterKey, filterValue);
      }
    }
    router.push(`/insights${params.size ? `?${params}` : ""}`);
  }
  const maxException = Math.max(
    1,
    ...dashboard.exceptionMix.map((item) => item.count),
  );
  const maxAging = Math.max(1, ...dashboard.aging.map((item) => item.count));

  return (
    <>
      <section className="workspace-hero compact-hero insights-hero">
        <div>
          <p className="kicker">
            <span>OPERATIONS INTELLIGENCE</span>
            <span>DETERMINISTIC METRICS</span>
          </p>
          <h1>See where payment work compounds.</h1>
          <p>
            Follow throughput, exception pressure, SLA health, and governed AI
            evidence without turning operational records into a black box.
          </p>
        </div>
        <div className="insights-window">
          <span>REPORTING WINDOW</span>
          <strong>{dashboard.filters.range.replace("d", " days")}</strong>
          <p>
            {new Date(dashboard.period.startAt).toLocaleDateString("en-IN", {
              day: "2-digit",
              month: "short",
            })}{" "}
            —{" "}
            {new Date(dashboard.period.endAt).toLocaleDateString("en-IN", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}
          </p>
        </div>
      </section>

      <section className="insights-filter-rail" aria-label="Insights filters">
        <label>
          RANGE
          <select
            value={dashboard.filters.range}
            onChange={(event) => setFilter("range", event.target.value)}
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
        </label>
        <label>
          PROVIDER
          <select
            value={dashboard.filters.provider}
            onChange={(event) => setFilter("provider", event.target.value)}
          >
            <option value="all">All providers</option>
            {dashboard.options.providers.map((provider) => (
              <option key={provider} value={provider}>
                {providerName(provider)}
              </option>
            ))}
          </select>
        </label>
        <label>
          PAYMENT MODE
          <select
            value={dashboard.filters.paymentMode}
            onChange={(event) => setFilter("paymentMode", event.target.value)}
          >
            <option value="all">All payment modes</option>
            {dashboard.options.paymentModes.map((mode) => (
              <option key={mode} value={mode}>{mode}</option>
            ))}
          </select>
        </label>
        <label>
          PRIORITY
          <select
            value={dashboard.filters.priority}
            onChange={(event) => setFilter("priority", event.target.value)}
          >
            <option value="all">All priorities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
      </section>

      {!dashboard.hasData ? (
        <section className="insights-empty">
          <DatabaseZap size={28} />
          <h2>No operational history in this window.</h2>
          <p>
            Run a reconciliation or seed the fictional Insights history to
            populate deterministic trends.
          </p>
          <Link href="/">Open reconciliation</Link>
        </section>
      ) : (
        <div className="insights-page">
          <section className="insights-kpis" aria-label="Period KPIs">
            <article>
              <span>PROCESSED VALUE</span>
              <strong>{money(dashboard.kpis.processedValue.value ?? 0)}</strong>
              <MetricDelta metric={dashboard.kpis.processedValue} />
            </article>
            <article>
              <span>MATCH RATE</span>
              <strong>{dashboard.kpis.matchRate.value ?? "—"}%</strong>
              <MetricDelta metric={dashboard.kpis.matchRate} />
            </article>
            <article>
              <span>ACTIONABLE EXCEPTIONS</span>
              <strong>{dashboard.kpis.actionableExceptions.value ?? 0}</strong>
              <MetricDelta
                metric={dashboard.kpis.actionableExceptions}
                invert
              />
            </article>
            <article>
              <span>MEDIAN RESOLUTION</span>
              <strong>
                {dashboard.kpis.medianResolutionHours.value === null
                  ? "—"
                  : `${dashboard.kpis.medianResolutionHours.value.toFixed(1)}h`}
              </strong>
              <MetricDelta
                metric={dashboard.kpis.medianResolutionHours}
                invert
              />
            </article>
          </section>

          <section className="insights-grid">
            <article className="insights-panel trend-panel">
              <header>
                <div>
                  <span>ACTIVITY SIGNAL</span>
                  <h2>Daily throughput and pressure</h2>
                </div>
                <CircleGauge size={20} />
              </header>
              <DailyTrend data={dashboard.dailyTrend} />
            </article>

            <article className="insights-panel queue-panel">
              <header>
                <div>
                  <span>CURRENT QUEUE</span>
                  <h2>Work requiring attention now</h2>
                </div>
              </header>
              <div className="queue-ledger">
                {[
                  ["active", dashboard.currentQueue.active, {}],
                  ["at risk", dashboard.currentQueue.atRisk, { sla: "at_risk" }],
                  ["overdue", dashboard.currentQueue.overdue, { sla: "overdue" }],
                  ["unassigned", dashboard.currentQueue.unassigned, { owner: "unassigned" }],
                ].map(([label, value, params]) => (
                  <Link
                    key={label as string}
                    href={operationsDrilldown(params as Record<string, string>)}
                  >
                    <span>{label as string}</span>
                    <strong>{value as number}</strong>
                    <ArrowRight size={14} />
                  </Link>
                ))}
              </div>
              <footer className="queue-outcomes">
                <span>
                  {dashboard.periodOutcomes.resolvedCases} resolved in period
                </span>
                <strong>
                  {dashboard.periodOutcomes.slaBreachRate === null
                    ? "SLA outcome unavailable"
                    : `${dashboard.periodOutcomes.slaBreachRate}% breached SLA`}
                </strong>
              </footer>
            </article>

            <article className="insights-panel exception-panel">
              <header>
                <div>
                  <span>EXCEPTION MIX</span>
                  <h2>Where reconciliation breaks</h2>
                </div>
              </header>
              <div className="insights-bars">
                {dashboard.exceptionMix.map((item) => (
                  <Link
                    key={item.status}
                    href={operationsDrilldown({
                      exception: item.status,
                      provider: dashboard.filters.provider,
                      paymentMode: dashboard.filters.paymentMode,
                      priority: dashboard.filters.priority,
                    })}
                  >
                    <span>{exceptionLabels[item.status]}</span>
                    <i>
                      <b
                        style={{ width: `${(item.count / maxException) * 100}%` }}
                      />
                    </i>
                    <strong>{item.count}</strong>
                    <small>{money(item.amount)} variance</small>
                  </Link>
                ))}
              </div>
            </article>

            <article className="insights-panel aging-panel">
              <header>
                <div>
                  <span>WORKLOAD AGING</span>
                  <h2>Actionable workload age</h2>
                </div>
              </header>
              <div className="aging-columns">
                {dashboard.aging.map((item) => (
                  <Link
                    key={item.bucket}
                    href={operationsDrilldown({
                      age: item.bucket,
                      provider: dashboard.filters.provider,
                      paymentMode: dashboard.filters.paymentMode,
                      priority: dashboard.filters.priority,
                    })}
                  >
                    <i
                      style={{
                        height: `${Math.max(8, (item.count / maxAging) * 100)}%`,
                      }}
                    />
                    <strong>{item.count}</strong>
                    <span>{agingLabels[item.bucket]}</span>
                  </Link>
                ))}
              </div>
            </article>

            <article className="insights-panel provider-panel">
              <header>
                <div>
                  <span>PROVIDER COMPARISON</span>
                  <h2>Reconciliation and settlement timing</h2>
                </div>
              </header>
              <div className="provider-table">
                <div className="provider-table-head">
                  <span>Provider</span>
                  <span>Match</span>
                  <span>On time</span>
                  <span>Late</span>
                  <span>Overdue</span>
                  <span>Median delay</span>
                </div>
                {dashboard.providerPerformance.map((provider) => (
                  <Link
                    key={provider.providerId}
                    href={operationsDrilldown({
                      provider: provider.providerId,
                      paymentMode: dashboard.filters.paymentMode,
                      priority: dashboard.filters.priority,
                      settlementStatus:
                        provider.overdueUnsettled > 0 ? "overdue" : undefined,
                    })}
                  >
                    <strong>
                      {providerName(provider.providerId)}
                      <small>{money(provider.processedValue)} processed</small>
                    </strong>
                    <span>{provider.matchRate ?? "—"}%</span>
                    <span>
                      {provider.onTimeSettlementRate === null
                        ? "Not enough data"
                        : `${provider.onTimeSettlementRate}%`}
                      <small>
                        {provider.onTimeSettlements}/
                        {provider.timingEligibleSettled} eligible
                      </small>
                    </span>
                    <span>{provider.lateSettlements}</span>
                    <span>{provider.overdueUnsettled}</span>
                    <span>
                      {provider.medianLateDelayHours === null
                        ? "—"
                        : `${provider.medianLateDelayHours.toFixed(1)}h`}
                    </span>
                  </Link>
                ))}
              </div>
            </article>

            <article className="insights-panel settlement-insights-panel">
              <header>
                <div>
                  <span>MERCHANT SETTLEMENTS</span>
                  <h2>Gross-to-net payable evidence</h2>
                </div>
                <Banknote size={20} />
              </header>
              <div className="root-cause-insights-ledger">
                <div>
                  <span>Gross collected</span>
                  <strong>{money(dashboard.merchantSettlements.grossCollected)}</strong>
                </div>
                <div>
                  <span>Deductions</span>
                  <strong>{money(dashboard.merchantSettlements.totalDeductions)}</strong>
                </div>
                <div>
                  <span>Net payable</span>
                  <strong>{money(dashboard.merchantSettlements.netPayable)}</strong>
                </div>
                <div>
                  <span>Credited</span>
                  <strong>{money(dashboard.merchantSettlements.creditedAmount)}</strong>
                </div>
                <div>
                  <span>Held / failed</span>
                  <strong>
                    {money(
                      dashboard.merchantSettlements.heldAmount +
                        dashboard.merchantSettlements.failedAmount,
                    )}
                  </strong>
                </div>
                <div>
                  <span>UTR match</span>
                  <strong>
                    {dashboard.merchantSettlements.utrMatchRate === null
                      ? "Not enough data"
                      : `${dashboard.merchantSettlements.utrMatchRate}%`}
                  </strong>
                </div>
              </div>
              <p className="settlement-insights-note">
                Includes synthetic settlement batches only; no live bank or
                payout integration is measured.
              </p>
              <Link className="root-cause-insights-link" href="/settlements">
                Open settlement statements <ArrowRight size={14} />
              </Link>
            </article>

            <article className="insights-panel governance-panel">
              <header>
                <div>
                  <span>AI GOVERNANCE</span>
                  <h2>Human review remains the control</h2>
                </div>
                <ShieldCheck size={20} />
              </header>
              <div className="governance-grid">
                <div><span>Investigations</span><strong>{dashboard.aiGovernance.investigations}</strong></div>
                <div><span>Approval</span><strong>{dashboard.aiGovernance.approvalRate === null ? "Not enough data" : `${dashboard.aiGovernance.approvalRate}%`}</strong></div>
                <div><span>Helpful</span><strong>{dashboard.aiGovernance.helpfulnessRate === null ? "Not enough data" : `${dashboard.aiGovernance.helpfulnessRate}%`}</strong></div>
                <div><span>Reviewer disagreement</span><strong>{dashboard.aiGovernance.reviewerDisagreementRate === null ? "Not enough data" : `${dashboard.aiGovernance.reviewerDisagreementRate}%`}</strong></div>
                <div><span>Critical safety failures</span><strong>{dashboard.aiGovernance.criticalSafetyFailures}</strong></div>
              </div>
            </article>

            <article className="insights-panel inbound-panel">
              <header>
                <div>
                  <span>SIGNED INBOUND EVIDENCE</span>
                  <h2>Normalized events received</h2>
                </div>
              </header>
              <div className="inbound-list">
                {dashboard.inboundEvidence.length ? (
                  dashboard.inboundEvidence.map((item) => (
                    <div key={item.providerId}>
                      <strong>{providerName(item.providerId)}</strong>
                      <span>{item.deliveries} deliveries</span>
                      <span>{item.matchedEvents} linked records</span>
                    </div>
                  ))
                ) : (
                  <p>No signed provider evidence in this period.</p>
                )}
              </div>
            </article>

            <article className="insights-panel root-cause-insights-panel">
              <header>
                <div>
                  <span>ROOT-CAUSE CONTROL</span>
                  <h2>Recurring work converted into programs</h2>
                </div>
                <GitBranch size={20} />
              </header>
              <div className="root-cause-insights-ledger">
                <div>
                  <span>Open programs</span>
                  <strong>{dashboard.rootCausePrograms.openPrograms}</strong>
                </div>
                <div>
                  <span>Recurring exposure</span>
                  <strong>{money(dashboard.rootCausePrograms.recurringExposure)}</strong>
                </div>
                <div>
                  <span>Verified fixes</span>
                  <strong>{dashboard.rootCausePrograms.verifiedFixes}</strong>
                </div>
              </div>
              <div className="root-cause-mini-trend" aria-label="Linked recurring cases by day">
                {dashboard.rootCausePrograms.recurrenceTrend.map((point) => {
                  const max = Math.max(
                    1,
                    ...dashboard.rootCausePrograms.recurrenceTrend.map(
                      (item) => item.linkedCases,
                    ),
                  );
                  return (
                    <i
                      key={point.date}
                      style={{
                        height: `${Math.max(5, (point.linkedCases / max) * 100)}%`,
                      }}
                      title={`${shortDate(point.date)}: ${point.linkedCases} linked cases`}
                    />
                  );
                })}
              </div>
              <Link className="root-cause-insights-link" href="/root-causes">
                Open recurrence control board <ArrowRight size={14} />
              </Link>
            </article>
          </section>
        </div>
      )}
    </>
  );
}
