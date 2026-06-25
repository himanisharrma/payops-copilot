import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import { withCloseReadiness } from "@/lib/close-control";
import type {
  ProviderId,
  ReconciliationClosePeriod,
  ReconciliationCloseReadiness,
  ReconciliationCloseVersion,
} from "@/lib/types";

type CloseScope = {
  businessDate: string;
  providerId: ProviderId;
  paymentMode: string;
};

const exposureSql = `CASE
  WHEN item.reconciliation_status = 'amount_mismatch'
    THEN ABS(item.variance)
  WHEN item.reconciliation_status IN (
    'gateway_missing', 'duplicate', 'missing_settlement'
  )
    THEN ABS(COALESCE(
      item.expected_net,
      item.gateway_amount,
      item.order_amount,
      item.variance,
      0
    ))
  ELSE 0
END`;

export async function getCloseReadiness(
  organizationId: string,
  scope: CloseScope,
  thresholds: {
    unresolvedCountThreshold: number;
    unresolvedAmountThreshold: number;
  },
  client?: PoolClient,
): Promise<ReconciliationCloseReadiness> {
  const execute = client ? client.query.bind(client) : query;
  const result = await execute<{
    run_count: string;
    item_count: string;
    processed_value: string;
    matched_value: string;
    actionable_exception_count: string;
    unresolved_case_count: string;
    unresolved_exposure: string;
    blocking_case_count: string;
  }>(
    `SELECT
       COUNT(DISTINCT run.id)::text AS run_count,
       COUNT(item.id)::text AS item_count,
       COALESCE(SUM(item.order_amount), 0)::text AS processed_value,
       COALESCE(SUM(
         CASE WHEN item.reconciliation_status = 'matched'
           THEN item.order_amount ELSE 0 END
       ), 0)::text AS matched_value,
       COUNT(*) FILTER (
         WHERE item.reconciliation_status NOT IN ('matched', 'pending')
       )::text AS actionable_exception_count,
       COUNT(payment_case.id) FILTER (
         WHERE payment_case.case_status <> 'resolved'
       )::text AS unresolved_case_count,
       COALESCE(SUM(
         CASE WHEN payment_case.case_status <> 'resolved'
           THEN ${exposureSql} ELSE 0 END
       ), 0)::text AS unresolved_exposure,
       COUNT(payment_case.id) FILTER (
         WHERE payment_case.case_status <> 'resolved'
           AND payment_case.priority = 'high'
       )::text AS blocking_case_count
     FROM reconciliation_runs run
     LEFT JOIN reconciliation_items item
       ON item.run_id = run.id
      AND item.organization_id = run.organization_id
      AND LOWER(item.payment_mode) = LOWER($4)
     LEFT JOIN operations_cases payment_case
       ON payment_case.item_id = item.id
      AND payment_case.organization_id = item.organization_id
     WHERE run.organization_id = $1
       AND run.provider_id = $3
       AND run.status = 'completed'
       AND (run.created_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date`,
    [
      organizationId,
      scope.businessDate,
      scope.providerId,
      scope.paymentMode,
    ],
  );
  const unresolved = await execute<{
    id: string;
    order_id: string;
    reconciliation_status: ReconciliationCloseReadiness["unresolvedCases"][number]["reconciliationStatus"];
    priority: ReconciliationCloseReadiness["unresolvedCases"][number]["priority"];
    exposure: string;
    owner: string | null;
  }>(
    `SELECT payment_case.id, item.order_id, item.reconciliation_status,
       payment_case.priority, ${exposureSql}::text AS exposure,
       payment_case.owner
     FROM operations_cases payment_case
     JOIN reconciliation_items item
       ON item.id = payment_case.item_id
      AND item.organization_id = payment_case.organization_id
     JOIN reconciliation_runs run
       ON run.id = item.run_id
      AND run.organization_id = item.organization_id
     WHERE run.organization_id = $1
       AND (run.created_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date
       AND run.provider_id = $3
       AND LOWER(item.payment_mode) = LOWER($4)
       AND payment_case.case_status <> 'resolved'
     ORDER BY
       CASE payment_case.priority
         WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3
       END,
       payment_case.created_at`,
    [
      organizationId,
      scope.businessDate,
      scope.providerId,
      scope.paymentMode,
    ],
  );
  const row = result.rows[0];
  return withCloseReadiness({
    ...scope,
    runCount: Number(row.run_count),
    itemCount: Number(row.item_count),
    processedValue: Number(row.processed_value),
    matchedValue: Number(row.matched_value),
    actionableExceptionCount: Number(row.actionable_exception_count),
    unresolvedCaseCount: Number(row.unresolved_case_count),
    unresolvedExposure: Number(row.unresolved_exposure),
    blockingCaseCount: Number(row.blocking_case_count),
    ...thresholds,
    unresolvedCases: unresolved.rows.map((item) => ({
      id: item.id,
      orderId: item.order_id,
      reconciliationStatus: item.reconciliation_status,
      priority: item.priority,
      exposure: Number(item.exposure),
      owner: item.owner,
    })),
  });
}

export async function getOrCreateClosePeriod(
  client: PoolClient,
  organizationId: string,
  scope: CloseScope,
  thresholds: {
    unresolvedCountThreshold: number;
    unresolvedAmountThreshold: number;
  },
) {
  const result = await client.query<{ id: string }>(
    `INSERT INTO reconciliation_close_periods (
       organization_id, business_date, provider_id, payment_mode,
       unresolved_count_threshold, unresolved_amount_threshold
     ) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (
       organization_id, business_date, provider_id, payment_mode
     ) DO UPDATE SET
       unresolved_count_threshold = EXCLUDED.unresolved_count_threshold,
       unresolved_amount_threshold = EXCLUDED.unresolved_amount_threshold,
       updated_at = NOW()
     RETURNING id`,
    [
      organizationId,
      scope.businessDate,
      scope.providerId,
      scope.paymentMode,
      thresholds.unresolvedCountThreshold,
      thresholds.unresolvedAmountThreshold,
    ],
  );
  return result.rows[0].id;
}

export async function createCloseVersion(
  client: PoolClient,
  input: {
    organizationId: string;
    periodId: string;
    snapshot: ReconciliationCloseReadiness;
    snapshotHash: string;
    preparedByUserId: string;
    preparedByName: string;
    dispositions: Array<{
      caseId: string;
      reason: string;
      evidenceConfirmed: boolean;
    }>;
  },
) {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext($1))",
    [input.periodId],
  );
  const version = await client.query<{
    id: string;
    version_number: number;
  }>(
    `INSERT INTO reconciliation_close_versions (
       organization_id, period_id, version_number, snapshot, snapshot_hash,
       prepared_by_user_id, prepared_by_name
     )
     SELECT $1,$2,COALESCE(MAX(version_number), 0) + 1,$3,$4,$5,$6
     FROM reconciliation_close_versions
     WHERE period_id = $2
     RETURNING id, version_number`,
    [
      input.organizationId,
      input.periodId,
      JSON.stringify(input.snapshot),
      input.snapshotHash,
      input.preparedByUserId,
      input.preparedByName,
    ],
  );
  for (const disposition of input.dispositions) {
    await client.query(
      `INSERT INTO reconciliation_close_dispositions (
         organization_id, version_id, case_id, reason, evidence_confirmed
       ) VALUES ($1,$2,$3,$4,$5)`,
      [
        input.organizationId,
        version.rows[0].id,
        disposition.caseId,
        disposition.reason,
        disposition.evidenceConfirmed,
      ],
    );
  }
  await client.query(
    `UPDATE reconciliation_close_periods
     SET status = 'submitted', active_version_id = $2,
       reopened_by_user_id = NULL, reopened_by_name = NULL,
       reopened_reason = NULL, reopened_at = NULL, updated_at = NOW()
     WHERE id = $1 AND organization_id = $3`,
    [input.periodId, version.rows[0].id, input.organizationId],
  );
  return version.rows[0];
}

export async function approveClosePeriod(
  client: PoolClient,
  input: {
    periodId: string;
    organizationId: string;
    approverUserId: string;
    approverName: string;
  },
) {
  const result = await client.query<{
    version_id: string;
    prepared_by_user_id: string | null;
  }>(
    `SELECT version.id AS version_id, version.prepared_by_user_id
     FROM reconciliation_close_periods period
     JOIN reconciliation_close_versions version
       ON version.id = period.active_version_id
      AND version.organization_id = period.organization_id
     WHERE period.id = $1
       AND period.organization_id = $2
       AND period.status = 'submitted'
     FOR UPDATE OF period, version`,
    [input.periodId, input.organizationId],
  );
  if (!result.rowCount) return null;
  if (result.rows[0].prepared_by_user_id === input.approverUserId) {
    return { makerConflict: true as const };
  }
  await client.query(
    `UPDATE reconciliation_close_versions
     SET approved_by_user_id = $2, approved_by_name = $3,
       approved_at = NOW()
     WHERE id = $1 AND organization_id = $4`,
    [
      result.rows[0].version_id,
      input.approverUserId,
      input.approverName,
      input.organizationId,
    ],
  );
  await client.query(
    `UPDATE reconciliation_close_periods
     SET status = 'approved', updated_at = NOW()
     WHERE id = $1 AND organization_id = $2`,
    [input.periodId, input.organizationId],
  );
  return { makerConflict: false as const };
}

export async function reopenClosePeriod(
  client: PoolClient,
  input: {
    periodId: string;
    organizationId: string;
    actorUserId: string;
    actorName: string;
    reason: string;
  },
) {
  const result = await client.query<{ id: string }>(
    `UPDATE reconciliation_close_periods
     SET status = 'reopened', reopened_by_user_id = $3,
       reopened_by_name = $4, reopened_reason = $5,
       reopened_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND organization_id = $2 AND status = 'approved'
     RETURNING id`,
    [
      input.periodId,
      input.organizationId,
      input.actorUserId,
      input.actorName,
      input.reason,
    ],
  );
  return result.rowCount ? result.rows[0] : null;
}

export async function getClosePeriodById(
  id: string,
  organizationId: string,
  client?: PoolClient,
) {
  const execute = client ? client.query.bind(client) : query;
  const result = await execute<PeriodRow>(
    `SELECT period.*,
       TO_CHAR(period.business_date, 'YYYY-MM-DD') AS business_date_text
     FROM reconciliation_close_periods period
     WHERE period.id = $1 AND period.organization_id = $2`,
    [id, organizationId],
  );
  return result.rowCount
    ? mapPeriod(result.rows[0], organizationId, client)
    : null;
}

export async function getClosePeriodByScope(
  organizationId: string,
  scope: CloseScope,
  client?: PoolClient,
) {
  const execute = client ? client.query.bind(client) : query;
  const result = await execute<PeriodRow>(
    `SELECT period.*,
       TO_CHAR(period.business_date, 'YYYY-MM-DD') AS business_date_text
     FROM reconciliation_close_periods period
     WHERE period.organization_id = $1 AND period.business_date = $2
       AND period.provider_id = $3
       AND LOWER(period.payment_mode) = LOWER($4)`,
    [
      organizationId,
      scope.businessDate,
      scope.providerId,
      scope.paymentMode,
    ],
  );
  return result.rowCount
    ? mapPeriod(result.rows[0], organizationId, client)
    : null;
}

export async function listClosePeriods(organizationId: string) {
  const result = await query<PeriodRow>(
    `SELECT period.*,
       TO_CHAR(period.business_date, 'YYYY-MM-DD') AS business_date_text
     FROM reconciliation_close_periods period
     WHERE period.organization_id = $1
     ORDER BY period.business_date DESC, period.updated_at DESC
     LIMIT 50`,
    [organizationId],
  );
  return Promise.all(
    result.rows.map((row) => mapPeriod(row, organizationId)),
  );
}

export async function getCloseOptions(organizationId: string) {
  const result = await query<{
    provider_id: ProviderId;
    payment_mode: string;
    business_date: string;
  }>(
    `SELECT DISTINCT run.provider_id, item.payment_mode,
       TO_CHAR(
         (run.created_at AT TIME ZONE 'Asia/Kolkata')::date,
         'YYYY-MM-DD'
       ) AS business_date
     FROM reconciliation_runs run
     JOIN reconciliation_items item
       ON item.run_id = run.id AND item.organization_id = run.organization_id
     WHERE run.organization_id = $1 AND run.status = 'completed'
     ORDER BY business_date DESC, run.provider_id, item.payment_mode`,
    [organizationId],
  );
  return {
    providers: [...new Set(result.rows.map((row) => row.provider_id))],
    paymentModes: [...new Set(result.rows.map((row) => row.payment_mode))],
    businessDates: [
      ...new Set(result.rows.map((row) => row.business_date)),
    ],
    scopes: result.rows.map((row) => ({
      businessDate: row.business_date,
      providerId: row.provider_id,
      paymentMode: row.payment_mode,
    })),
  };
}

type PeriodRow = {
  id: string;
  business_date: string | Date;
  business_date_text: string;
  provider_id: ProviderId;
  payment_mode: string;
  status: ReconciliationClosePeriod["status"];
  unresolved_count_threshold: number;
  unresolved_amount_threshold: string;
  active_version_id: string | null;
  reopened_by_name: string | null;
  reopened_reason: string | null;
  reopened_at: Date | null;
};

async function mapPeriod(
  row: PeriodRow,
  organizationId: string,
  client?: PoolClient,
): Promise<Omit<ReconciliationClosePeriod, "readiness">> {
  return {
    id: row.id,
    businessDate: row.business_date_text,
    providerId: row.provider_id,
    paymentMode: row.payment_mode,
    status: row.status,
    unresolvedCountThreshold: row.unresolved_count_threshold,
    unresolvedAmountThreshold: Number(row.unresolved_amount_threshold),
    reopenedByName: row.reopened_by_name,
    reopenedReason: row.reopened_reason,
    reopenedAt: row.reopened_at?.toISOString() ?? null,
    activeVersion: row.active_version_id
      ? await getCloseVersion(row.active_version_id, organizationId, client)
      : null,
  };
}

async function getCloseVersion(
  id: string,
  organizationId: string,
  client?: PoolClient,
): Promise<ReconciliationCloseVersion | null> {
  const execute = client ? client.query.bind(client) : query;
  const version = await execute<{
    id: string;
    version_number: number;
    snapshot_hash: string;
    snapshot: ReconciliationCloseReadiness;
    prepared_by_name: string;
    prepared_at: Date;
    approved_by_name: string | null;
    approved_at: Date | null;
  }>(
    `SELECT * FROM reconciliation_close_versions
     WHERE id = $1 AND organization_id = $2`,
    [id, organizationId],
  );
  if (!version.rowCount) return null;
  const dispositions = await execute<{
    case_id: string;
    reason: string;
    evidence_confirmed: boolean;
  }>(
    `SELECT case_id, reason, evidence_confirmed
     FROM reconciliation_close_dispositions
     WHERE version_id = $1 AND organization_id = $2
     ORDER BY created_at`,
    [id, organizationId],
  );
  const row = version.rows[0];
  return {
    id: row.id,
    versionNumber: row.version_number,
    snapshotHash: row.snapshot_hash,
    snapshot: row.snapshot,
    preparedByName: row.prepared_by_name,
    preparedAt: row.prepared_at.toISOString(),
    approvedByName: row.approved_by_name,
    approvedAt: row.approved_at?.toISOString() ?? null,
    dispositions: dispositions.rows.map((item) => ({
      caseId: item.case_id,
      reason: item.reason,
      evidenceConfirmed: item.evidence_confirmed,
    })),
  };
}
