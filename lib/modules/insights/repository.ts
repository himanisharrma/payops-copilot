import { query } from "@/lib/db";
import { metricChange, rangeDays } from "@/lib/insights";
import type {
  InsightsDashboard,
  InsightsFilters,
  ProviderId,
  ReconciliationStatus,
} from "@/lib/types";

type MetricRow = {
  processed_value: string | null;
  total_items: number;
  matched_items: number;
  actionable_exceptions: number;
  median_resolution_hours: string | null;
  resolved_cases: number;
  breached_cases: number;
};

const filterSql = `
  ($4::text = 'all' OR run.provider_id = $4)
  AND ($5::text = 'all' OR item.payment_mode = $5)
  AND ($6::text = 'all' OR payment_case.priority = $6)
`;

const currentFilterSql = `
  ($2::text = 'all' OR run.provider_id = $2)
  AND ($3::text = 'all' OR item.payment_mode = $3)
  AND ($4::text = 'all' OR payment_case.priority = $4)
`;

function metricFromRows(
  current: MetricRow,
  previous: MetricRow,
  key:
    | "processed_value"
    | "actionable_exceptions"
    | "median_resolution_hours",
) {
  const currentValue =
    current[key] === null ? null : Number(current[key]);
  const previousValue =
    previous[key] === null ? null : Number(previous[key]);
  return {
    value: currentValue,
    previousValue,
    changePercent: metricChange(currentValue, previousValue),
  };
}

function matchRate(row: MetricRow) {
  return row.total_items
    ? Number(((row.matched_items / row.total_items) * 100).toFixed(1))
    : null;
}

export async function getInsightsDashboard(
  organizationId: string,
  filters: InsightsFilters,
): Promise<InsightsDashboard> {
  const days = rangeDays(filters.range);
  const endAt = new Date();
  const startAt = new Date(endAt.getTime() - days * 86_400_000);
  const previousEndAt = startAt;
  const previousStartAt = new Date(
    previousEndAt.getTime() - days * 86_400_000,
  );
  const params = [
    organizationId,
    startAt,
    endAt,
    filters.provider,
    filters.paymentMode,
    filters.priority,
  ];
  const previousParams = [
    organizationId,
    previousStartAt,
    previousEndAt,
    filters.provider,
    filters.paymentMode,
    filters.priority,
  ];
  const currentFilterParams = [
    organizationId,
    filters.provider,
    filters.paymentMode,
    filters.priority,
  ];

  const [
    currentMetrics,
    previousMetrics,
    currentQueue,
    dailyTrend,
    exceptionMix,
    aging,
    providerPerformance,
    aiGovernance,
    inboundEvidence,
    paymentModes,
  ] = await Promise.all([
    query<MetricRow>(
      `SELECT
         COALESCE(SUM(item.order_amount), 0) AS processed_value,
         COUNT(*)::int AS total_items,
         COUNT(*) FILTER (
           WHERE item.reconciliation_status = 'matched'
         )::int AS matched_items,
         COUNT(*) FILTER (
           WHERE item.reconciliation_status NOT IN ('matched', 'pending')
             AND (
               item.reconciliation_status <> 'missing_settlement'
               OR item.expected_settlement_at < NOW()
               OR payment_case.id IS NOT NULL
             )
         )::int AS actionable_exceptions,
         COUNT(*) FILTER (
           WHERE payment_case.resolved_at IS NOT NULL
         )::int AS resolved_cases,
         COUNT(*) FILTER (
           WHERE payment_case.resolved_at > payment_case.due_at
         )::int AS breached_cases,
         PERCENTILE_CONT(0.5) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM (
             payment_case.resolved_at - payment_case.created_at
           )) / 3600
         ) FILTER (
           WHERE payment_case.resolved_at IS NOT NULL
         ) AS median_resolution_hours
       FROM reconciliation_items item
       JOIN reconciliation_runs run
         ON run.id = item.run_id
        AND run.organization_id = item.organization_id
       LEFT JOIN operations_cases payment_case
         ON payment_case.item_id = item.id
        AND payment_case.organization_id = item.organization_id
       WHERE item.organization_id = $1
         AND item.created_at >= $2 AND item.created_at < $3
         AND ${filterSql}`,
      params,
    ),
    query<MetricRow>(
      `SELECT
         COALESCE(SUM(item.order_amount), 0) AS processed_value,
         COUNT(*)::int AS total_items,
         COUNT(*) FILTER (
           WHERE item.reconciliation_status = 'matched'
         )::int AS matched_items,
         COUNT(*) FILTER (
           WHERE item.reconciliation_status NOT IN ('matched', 'pending')
             AND (
               item.reconciliation_status <> 'missing_settlement'
               OR item.expected_settlement_at < NOW()
               OR payment_case.id IS NOT NULL
             )
         )::int AS actionable_exceptions,
         COUNT(*) FILTER (
           WHERE payment_case.resolved_at IS NOT NULL
         )::int AS resolved_cases,
         COUNT(*) FILTER (
           WHERE payment_case.resolved_at > payment_case.due_at
         )::int AS breached_cases,
         PERCENTILE_CONT(0.5) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM (
             payment_case.resolved_at - payment_case.created_at
           )) / 3600
         ) FILTER (
           WHERE payment_case.resolved_at IS NOT NULL
         ) AS median_resolution_hours
       FROM reconciliation_items item
       JOIN reconciliation_runs run
         ON run.id = item.run_id
        AND run.organization_id = item.organization_id
       LEFT JOIN operations_cases payment_case
         ON payment_case.item_id = item.id
        AND payment_case.organization_id = item.organization_id
       WHERE item.organization_id = $1
         AND item.created_at >= $2 AND item.created_at < $3
         AND ${filterSql}`,
      previousParams,
    ),
    query<{
      active: number;
      at_risk: number;
      overdue: number;
      unassigned: number;
    }>(
      `SELECT
         COUNT(*)::int AS active,
         COUNT(*) FILTER (
           WHERE NOW() <= payment_case.due_at
             AND payment_case.due_at - NOW() <=
               CASE payment_case.priority
                 WHEN 'high' THEN INTERVAL '1 hour'
                 WHEN 'medium' THEN INTERVAL '6 hours'
                 ELSE INTERVAL '18 hours'
               END
         )::int AS at_risk,
         COUNT(*) FILTER (WHERE NOW() > payment_case.due_at)::int AS overdue,
         COUNT(*) FILTER (
           WHERE NULLIF(BTRIM(payment_case.owner), '') IS NULL
         )::int AS unassigned
       FROM operations_cases payment_case
       JOIN reconciliation_items item
         ON item.id = payment_case.item_id
        AND item.organization_id = payment_case.organization_id
       JOIN reconciliation_runs run
         ON run.id = payment_case.run_id
        AND run.organization_id = payment_case.organization_id
       WHERE payment_case.organization_id = $1
         AND payment_case.case_status <> 'resolved'
         AND ${currentFilterSql}`,
      currentFilterParams,
    ),
    query<{
      date: Date;
      orders: number;
      exceptions: number;
      resolved: number;
    }>(
      `WITH days AS (
         SELECT GENERATE_SERIES(
           DATE_TRUNC('day', $2::timestamptz),
           DATE_TRUNC('day', $3::timestamptz - INTERVAL '1 second'),
           INTERVAL '1 day'
         ) AS date
       ),
       activity AS (
         SELECT
           DATE_TRUNC('day', item.created_at) AS date,
           COUNT(*)::int AS orders,
           COUNT(*) FILTER (
             WHERE item.reconciliation_status NOT IN ('matched', 'pending')
               AND (
                 item.reconciliation_status <> 'missing_settlement'
                 OR item.expected_settlement_at < NOW()
                 OR payment_case.id IS NOT NULL
               )
           )::int AS exceptions
         FROM reconciliation_items item
         JOIN reconciliation_runs run
           ON run.id = item.run_id
          AND run.organization_id = item.organization_id
         LEFT JOIN operations_cases payment_case
           ON payment_case.item_id = item.id
          AND payment_case.organization_id = item.organization_id
         WHERE item.organization_id = $1
           AND item.created_at >= $2 AND item.created_at < $3
           AND ${filterSql}
         GROUP BY 1
       ),
       resolutions AS (
         SELECT DATE_TRUNC('day', payment_case.resolved_at) AS date,
           COUNT(*)::int AS resolved
         FROM operations_cases payment_case
         JOIN reconciliation_items item
           ON item.id = payment_case.item_id
          AND item.organization_id = payment_case.organization_id
         JOIN reconciliation_runs run
           ON run.id = payment_case.run_id
          AND run.organization_id = payment_case.organization_id
         WHERE payment_case.organization_id = $1
           AND payment_case.resolved_at >= $2
           AND payment_case.resolved_at < $3
           AND ${filterSql}
         GROUP BY 1
       )
       SELECT days.date,
         COALESCE(activity.orders, 0)::int AS orders,
         COALESCE(activity.exceptions, 0)::int AS exceptions,
         COALESCE(resolutions.resolved, 0)::int AS resolved
       FROM days
       LEFT JOIN activity USING (date)
       LEFT JOIN resolutions USING (date)
       ORDER BY days.date`,
      params,
    ),
    query<{
      status: ReconciliationStatus;
      count: number;
      amount: string;
    }>(
      `SELECT item.reconciliation_status AS status,
         COUNT(*)::int AS count,
         COALESCE(SUM(ABS(item.variance)), 0) AS amount
       FROM reconciliation_items item
       JOIN reconciliation_runs run
         ON run.id = item.run_id
        AND run.organization_id = item.organization_id
       LEFT JOIN operations_cases payment_case
         ON payment_case.item_id = item.id
        AND payment_case.organization_id = item.organization_id
       WHERE item.organization_id = $1
         AND item.created_at >= $2 AND item.created_at < $3
         AND item.reconciliation_status NOT IN ('matched', 'pending')
         AND (
           item.reconciliation_status <> 'missing_settlement'
           OR item.expected_settlement_at < NOW()
           OR payment_case.id IS NOT NULL
         )
         AND ${filterSql}
       GROUP BY item.reconciliation_status
       ORDER BY count DESC, status`,
      params,
    ),
    query<{ bucket: InsightsDashboard["aging"][number]["bucket"]; count: number }>(
      `SELECT CASE
           WHEN NOW() - CASE
             WHEN payment_case.case_origin = 'settlement_overdue'
               THEN item.expected_settlement_at
             ELSE payment_case.created_at
           END < INTERVAL '4 hours'
             THEN 'under_4h'
           WHEN NOW() - CASE
             WHEN payment_case.case_origin = 'settlement_overdue'
               THEN item.expected_settlement_at
             ELSE payment_case.created_at
           END < INTERVAL '24 hours'
             THEN '4h_24h'
           WHEN NOW() - CASE
             WHEN payment_case.case_origin = 'settlement_overdue'
               THEN item.expected_settlement_at
             ELSE payment_case.created_at
           END < INTERVAL '3 days'
             THEN '1d_3d'
           ELSE 'over_3d'
         END AS bucket,
         COUNT(*)::int AS count
       FROM operations_cases payment_case
       JOIN reconciliation_items item
         ON item.id = payment_case.item_id
        AND item.organization_id = payment_case.organization_id
       JOIN reconciliation_runs run
         ON run.id = payment_case.run_id
        AND run.organization_id = payment_case.organization_id
       WHERE payment_case.organization_id = $1
         AND payment_case.case_status <> 'resolved'
         AND ${currentFilterSql}
       GROUP BY 1`,
      currentFilterParams,
    ),
    query<{
      provider_id: ProviderId;
      total_orders: number;
      matched_orders: number;
      exception_count: number;
      processed_value: string;
      timing_eligible_settled: number;
      on_time_settlements: number;
      late_settlements: number;
      overdue_unsettled: number;
      median_late_delay_hours: string | null;
    }>(
      `SELECT run.provider_id,
         COUNT(*)::int AS total_orders,
         COUNT(*) FILTER (
           WHERE item.reconciliation_status = 'matched'
         )::int AS matched_orders,
         COUNT(*) FILTER (
           WHERE item.reconciliation_status NOT IN ('matched', 'pending')
             AND (
               item.reconciliation_status <> 'missing_settlement'
               OR item.expected_settlement_at < NOW()
               OR payment_case.id IS NOT NULL
             )
         )::int AS exception_count,
         COALESCE(SUM(item.order_amount), 0) AS processed_value,
         COUNT(*) FILTER (
           WHERE item.expected_settlement_at IS NOT NULL
             AND item.settlement_recorded_at IS NOT NULL
         )::int AS timing_eligible_settled,
         COUNT(*) FILTER (
           WHERE item.expected_settlement_at IS NOT NULL
             AND item.settlement_recorded_at IS NOT NULL
             AND item.settlement_recorded_at <= item.expected_settlement_at
         )::int AS on_time_settlements,
         COUNT(*) FILTER (
           WHERE item.expected_settlement_at IS NOT NULL
             AND item.settlement_recorded_at > item.expected_settlement_at
         )::int AS late_settlements,
         COUNT(*) FILTER (
           WHERE item.reconciliation_status = 'missing_settlement'
             AND item.settlement_recorded_at IS NULL
             AND item.expected_settlement_at < NOW()
         )::int AS overdue_unsettled,
         PERCENTILE_CONT(0.5) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM (
             item.settlement_recorded_at - item.expected_settlement_at
           )) / 3600
         ) FILTER (
           WHERE item.settlement_recorded_at > item.expected_settlement_at
         ) AS median_late_delay_hours
       FROM reconciliation_items item
       JOIN reconciliation_runs run
         ON run.id = item.run_id
        AND run.organization_id = item.organization_id
       LEFT JOIN operations_cases payment_case
         ON payment_case.item_id = item.id
        AND payment_case.organization_id = item.organization_id
       WHERE item.organization_id = $1
         AND item.created_at >= $2 AND item.created_at < $3
         AND ${filterSql}
       GROUP BY run.provider_id
       ORDER BY processed_value DESC`,
      params,
    ),
    query<{
      investigations: number;
      reviewed: number;
      approved: number;
      rated: number;
      helpful: number;
      double_reviewed: number;
      disputed: number;
      critical_safety_failures: number;
    }>(
      `WITH investigations AS (
         SELECT ai.*
         FROM ai_investigations ai
         JOIN operations_cases payment_case ON payment_case.id = ai.case_id
         WHERE payment_case.organization_id = $1
           AND ai.created_at >= $2 AND ai.created_at < $3
       ),
       review_pairs AS (
         SELECT review.evaluation_case_result_id,
           COUNT(*)::int AS review_count,
           COUNT(DISTINCT (
             review.grounding_score, review.safety_score,
             review.uncertainty_score, review.action_score,
             review.provider_message_score, review.completeness_score
           ))::int AS distinct_scores
         FROM evaluation_case_reviews review
         JOIN evaluation_runs run ON run.id = review.evaluation_run_id
         WHERE review.organization_id = $1
           AND run.organization_id = $1
           AND review.reviewed_at >= $2 AND review.reviewed_at < $3
         GROUP BY review.evaluation_case_result_id
       )
       SELECT
         (SELECT COUNT(*) FROM investigations)::int AS investigations,
         (SELECT COUNT(*) FROM investigations
          WHERE approval_status <> 'pending')::int AS reviewed,
         (SELECT COUNT(*) FROM investigations
          WHERE approval_status = 'approved')::int AS approved,
         (SELECT COUNT(*) FROM investigations
          WHERE feedback_rating IS NOT NULL)::int AS rated,
         (SELECT COUNT(*) FROM investigations
          WHERE feedback_rating = 'helpful')::int AS helpful,
         (SELECT COUNT(*) FROM review_pairs
          WHERE review_count = 2)::int AS double_reviewed,
         (SELECT COUNT(*) FROM review_pairs
          WHERE review_count = 2 AND distinct_scores > 1)::int AS disputed,
         COALESCE((
           SELECT SUM(run.critical_safety_failures)::int
           FROM evaluation_runs run
           WHERE run.organization_id = $1
             AND run.created_at >= $2 AND run.created_at < $3
         ), 0)::int AS critical_safety_failures`,
      [organizationId, startAt, endAt],
    ),
    query<{
      provider_id: Exclude<ProviderId, "generic">;
      deliveries: number;
      matched_events: number;
    }>(
      `SELECT delivery.provider_id,
         COUNT(*)::int AS deliveries,
         COUNT(*) FILTER (
           WHERE EXISTS (
             SELECT 1
             FROM provider_events event
             WHERE event.delivery_id = delivery.id
               AND event.organization_id = delivery.organization_id
               AND (
                 EXISTS (
                   SELECT 1 FROM reconciliation_items item
                   WHERE item.organization_id = delivery.organization_id
                     AND (
                       item.order_id = event.order_id
                       OR item.gateway_reference = event.payment_reference
                     )
                 )
                 OR EXISTS (
                   SELECT 1 FROM payment_workflows workflow
                   WHERE workflow.organization_id = delivery.organization_id
                     AND (
                       workflow.order_id = event.order_id
                       OR workflow.payment_reference = event.payment_reference
                       OR workflow.external_reference = event.external_reference
                     )
                 )
               )
           )
         )::int AS matched_events
       FROM provider_webhook_deliveries delivery
       WHERE delivery.organization_id = $1
         AND delivery.received_at >= $2 AND delivery.received_at < $3
         AND ($4::text = 'all' OR delivery.provider_id = $4)
       GROUP BY delivery.provider_id
       ORDER BY deliveries DESC`,
      [organizationId, startAt, endAt, filters.provider],
    ),
    query<{ payment_mode: string }>(
      `SELECT DISTINCT item.payment_mode
       FROM reconciliation_items item
       WHERE item.organization_id = $1
         AND NULLIF(BTRIM(item.payment_mode), '') IS NOT NULL
       ORDER BY item.payment_mode`,
      [organizationId],
    ),
  ]);

  const current = currentMetrics.rows[0];
  const previous = previousMetrics.rows[0];
  const currentMatchRate = matchRate(current);
  const previousMatchRate = matchRate(previous);
  const ai = aiGovernance.rows[0];
  const agingOrder: InsightsDashboard["aging"][number]["bucket"][] = [
    "under_4h",
    "4h_24h",
    "1d_3d",
    "over_3d",
  ];
  const agingMap = new Map(aging.rows.map((row) => [row.bucket, row.count]));

  return {
    filters,
    options: {
      providers: ["generic", "razorpay_demo", "cashfree_demo", "payu_demo"],
      paymentModes: paymentModes.rows.map((row) => row.payment_mode),
    },
    period: {
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      previousStartAt: previousStartAt.toISOString(),
      previousEndAt: previousEndAt.toISOString(),
    },
    hasData: current.total_items > 0,
    kpis: {
      processedValue: metricFromRows(current, previous, "processed_value"),
      matchRate: {
        value: currentMatchRate,
        previousValue: previousMatchRate,
        changePercent: metricChange(currentMatchRate, previousMatchRate),
      },
      actionableExceptions: metricFromRows(
        current,
        previous,
        "actionable_exceptions",
      ),
      medianResolutionHours: metricFromRows(
        current,
        previous,
        "median_resolution_hours",
      ),
    },
    currentQueue: {
      active: currentQueue.rows[0].active,
      atRisk: currentQueue.rows[0].at_risk,
      overdue: currentQueue.rows[0].overdue,
      unassigned: currentQueue.rows[0].unassigned,
    },
    periodOutcomes: {
      resolvedCases: current.resolved_cases,
      slaBreachRate: current.resolved_cases
        ? Number(
            ((current.breached_cases / current.resolved_cases) * 100).toFixed(
              1,
            ),
          )
        : null,
    },
    dailyTrend: dailyTrend.rows.map((row) => ({
      date: row.date.toISOString(),
      orders: row.orders,
      exceptions: row.exceptions,
      resolved: row.resolved,
    })),
    exceptionMix: exceptionMix.rows.map((row) => ({
      status: row.status,
      count: row.count,
      amount: Number(row.amount),
    })),
    aging: agingOrder.map((bucket) => ({
      bucket,
      count: agingMap.get(bucket) ?? 0,
    })),
    providerPerformance: providerPerformance.rows.map((row) => ({
      providerId: row.provider_id,
      totalOrders: row.total_orders,
      matchRate: row.total_orders
        ? Number(((row.matched_orders / row.total_orders) * 100).toFixed(1))
        : null,
      exceptionCount: row.exception_count,
      processedValue: Number(row.processed_value),
      timingEligibleSettled: row.timing_eligible_settled,
      onTimeSettlements: row.on_time_settlements,
      lateSettlements: row.late_settlements,
      onTimeSettlementRate: row.timing_eligible_settled
        ? Number(
            (
              (row.on_time_settlements / row.timing_eligible_settled) *
              100
            ).toFixed(1),
          )
        : null,
      overdueUnsettled: row.overdue_unsettled,
      medianLateDelayHours:
        row.median_late_delay_hours === null
          ? null
          : Number(row.median_late_delay_hours),
    })),
    aiGovernance: {
      investigations: ai.investigations,
      approvalRate: ai.reviewed
        ? Number(((ai.approved / ai.reviewed) * 100).toFixed(1))
        : null,
      helpfulnessRate: ai.rated
        ? Number(((ai.helpful / ai.rated) * 100).toFixed(1))
        : null,
      reviewerDisagreementRate: ai.double_reviewed
        ? Number(((ai.disputed / ai.double_reviewed) * 100).toFixed(1))
        : null,
      criticalSafetyFailures: ai.critical_safety_failures,
    },
    inboundEvidence: inboundEvidence.rows.map((row) => ({
      providerId: row.provider_id,
      deliveries: row.deliveries,
      matchedEvents: row.matched_events,
    })),
  };
}
