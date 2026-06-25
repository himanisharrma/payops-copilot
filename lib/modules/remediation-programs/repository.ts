import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import {
  rankRecurrence,
  recurrenceMinimumCases,
  recurrenceWindow,
  remediationFingerprint,
} from "@/lib/remediation-programs";
import type {
  ProviderId,
  RecurrenceSuggestion,
  RemediationCleanRun,
  RemediationProgram,
  RemediationProgramCase,
  RemediationProgramEvent,
  RemediationProgramStatus,
} from "@/lib/types";

export type RemediationFilters = {
  provider: ProviderId | "all";
  paymentMode: string | "all";
  status: RemediationProgramStatus | "all";
};

const exposureSql = `CASE
  WHEN item.reconciliation_status = 'amount_mismatch'
    THEN ABS(item.variance)
  WHEN item.reconciliation_status IN (
    'gateway_missing', 'duplicate', 'missing_settlement'
  )
    THEN ABS(item.order_amount)
  ELSE 0
END`;

export async function listRecurrenceSuggestions(
  organizationId: string,
  filters: RemediationFilters,
  client?: PoolClient,
) {
  const execute = client ? client.query.bind(client) : query;
  const window = recurrenceWindow();
  const result = await execute<{
    provider_id: ProviderId;
    payment_mode: string;
    reconciliation_status: RecurrenceSuggestion["reconciliationStatus"];
    case_origin: RecurrenceSuggestion["caseOrigin"];
    case_count: number;
    exposure: string;
    breached_cases: number;
    open_cases: number;
    first_occurred_at: Date;
    last_occurred_at: Date;
    promoted: boolean;
  }>(
    `SELECT run.provider_id, item.payment_mode,
       item.reconciliation_status, payment_case.case_origin,
       COUNT(*)::int AS case_count,
       SUM(${exposureSql})::text AS exposure,
       COUNT(*) FILTER (
         WHERE payment_case.resolved_at > payment_case.due_at
       )::int AS breached_cases,
       COUNT(*) FILTER (
         WHERE payment_case.case_status <> 'resolved'
       )::int AS open_cases,
       MIN(payment_case.created_at) AS first_occurred_at,
       MAX(payment_case.created_at) AS last_occurred_at,
       EXISTS (
         SELECT 1 FROM remediation_programs program
         WHERE program.organization_id = payment_case.organization_id
           AND program.fingerprint = CONCAT_WS(
             '|',
             run.provider_id,
             LOWER(BTRIM(item.payment_mode)),
             item.reconciliation_status,
             payment_case.case_origin
           )
           AND program.status IN ('active', 'monitoring')
       ) AS promoted
     FROM operations_cases payment_case
     JOIN reconciliation_items item
       ON item.id = payment_case.item_id
      AND item.organization_id = payment_case.organization_id
     JOIN reconciliation_runs run
       ON run.id = payment_case.run_id
      AND run.organization_id = payment_case.organization_id
     WHERE payment_case.organization_id = $1
       AND payment_case.created_at >= $2
       AND payment_case.created_at < $3
       AND item.reconciliation_status IN (
         'amount_mismatch', 'missing_settlement', 'gateway_missing', 'duplicate'
       )
       AND ($4::text = 'all' OR run.provider_id = $4)
       AND ($5::text = 'all' OR item.payment_mode = $5)
     GROUP BY run.provider_id, item.payment_mode,
       item.reconciliation_status, payment_case.case_origin,
       payment_case.organization_id
     HAVING COUNT(*) >= $6
     ORDER BY case_count DESC, SUM(${exposureSql}) DESC,
       breached_cases DESC, last_occurred_at DESC`,
    [
      organizationId,
      window.startAt,
      window.endAt,
      filters.provider,
      filters.paymentMode,
      recurrenceMinimumCases,
    ],
  );
  return result.rows
    .map((row): RecurrenceSuggestion => {
      const lastOccurredAt = row.last_occurred_at.toISOString();
      const fingerprint = remediationFingerprint({
        providerId: row.provider_id,
        paymentMode: row.payment_mode,
        reconciliationStatus: row.reconciliation_status,
        caseOrigin: row.case_origin,
      });
      return {
        fingerprint,
        providerId: row.provider_id,
        paymentMode: row.payment_mode,
        reconciliationStatus: row.reconciliation_status,
        caseOrigin: row.case_origin,
        caseCount: row.case_count,
        exposure: Number(row.exposure),
        breachedCases: row.breached_cases,
        openCases: row.open_cases,
        firstOccurredAt: row.first_occurred_at.toISOString(),
        lastOccurredAt,
        rankScore: rankRecurrence({
          caseCount: row.case_count,
          exposure: Number(row.exposure),
          breachedCases: row.breached_cases,
          lastOccurredAt,
        }),
        promoted: row.promoted,
      };
    })
    .sort((left, right) => right.rankScore - left.rankScore);
}

export async function listRemediationOwners(organizationId: string) {
  const result = await query<{
    id: string;
    name: string;
    role: "admin" | "analyst";
  }>(
    `SELECT id, name, role
     FROM users
     WHERE organization_id = $1
       AND active = TRUE
       AND role IN ('admin', 'analyst')
     ORDER BY role, name`,
    [organizationId],
  );
  return result.rows;
}

export async function getEligibleOwner(
  id: string,
  organizationId: string,
  client: PoolClient,
) {
  const result = await client.query<{
    id: string;
    name: string;
    role: "admin" | "analyst";
  }>(
    `SELECT id, name, role FROM users
     WHERE id = $1 AND organization_id = $2
       AND active = TRUE AND role IN ('admin', 'analyst')`,
    [id, organizationId],
  );
  return result.rows[0] ?? null;
}

export async function createRemediationProgram(
  client: PoolClient,
  input: {
    organizationId: string;
    suggestion: RecurrenceSuggestion;
    ownerUserId: string;
    ownerName: string;
    remediationPlan: string;
    targetDate: string;
    createdByUserId: string;
    createdByName: string;
  },
) {
  const window = recurrenceWindow();
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO remediation_programs (
       organization_id, fingerprint, provider_id, payment_mode,
       reconciliation_status, case_origin, owner_user_id, owner_name,
       remediation_plan, target_date, detection_window_start,
       detection_window_end, baseline_case_count, baseline_exposure,
       created_by_user_id, created_by_name
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
     ) RETURNING id`,
    [
      input.organizationId,
      input.suggestion.fingerprint,
      input.suggestion.providerId,
      input.suggestion.paymentMode,
      input.suggestion.reconciliationStatus,
      input.suggestion.caseOrigin,
      input.ownerUserId,
      input.ownerName,
      input.remediationPlan,
      input.targetDate,
      window.startAt,
      window.endAt,
      input.suggestion.caseCount,
      input.suggestion.exposure,
      input.createdByUserId,
      input.createdByName,
    ],
  );
  const programId = inserted.rows[0].id;
  const linked = await client.query<{ case_id: string }>(
    `INSERT INTO remediation_program_cases (
       organization_id, program_id, case_id, link_type
     )
     SELECT payment_case.organization_id, $2, payment_case.id, 'baseline'
     FROM operations_cases payment_case
     JOIN reconciliation_items item
       ON item.id = payment_case.item_id
      AND item.organization_id = payment_case.organization_id
     JOIN reconciliation_runs run
       ON run.id = payment_case.run_id
      AND run.organization_id = payment_case.organization_id
     WHERE payment_case.organization_id = $1
       AND payment_case.created_at >= $3
       AND payment_case.created_at < $4
       AND run.provider_id = $5
       AND LOWER(BTRIM(item.payment_mode)) = LOWER(BTRIM($6))
       AND item.reconciliation_status = $7
       AND payment_case.case_origin = $8
     ON CONFLICT DO NOTHING
     RETURNING case_id`,
    [
      input.organizationId,
      programId,
      window.startAt,
      window.endAt,
      input.suggestion.providerId,
      input.suggestion.paymentMode,
      input.suggestion.reconciliationStatus,
      input.suggestion.caseOrigin,
    ],
  );
  await insertProgramEvent(client, {
    organizationId: input.organizationId,
    programId,
    actorUserId: input.createdByUserId,
    actorName: input.createdByName,
    eventType: "program_created",
    details: {
      fingerprint: input.suggestion.fingerprint,
      baselineCaseCount: input.suggestion.caseCount,
      baselineExposure: input.suggestion.exposure,
      linkedCaseCount: linked.rows.length,
      ownerName: input.ownerName,
      targetDate: input.targetDate,
    },
  });
  return programId;
}

export async function updateRemediationProgram(
  client: PoolClient,
  input: {
    id: string;
    organizationId: string;
    ownerUserId?: string;
    ownerName?: string;
    remediationPlan?: string;
    targetDate?: string;
    implementationSummary?: string;
    implementationEvidenceReference?: string;
    actorUserId: string;
    actorName: string;
  },
) {
  const result = await client.query<{ id: string }>(
    `UPDATE remediation_programs
     SET owner_user_id = COALESCE($3, owner_user_id),
       owner_name = COALESCE($4, owner_name),
       remediation_plan = COALESCE($5, remediation_plan),
       target_date = COALESCE($6::date, target_date),
       status = CASE
         WHEN $7::text IS NOT NULL THEN 'monitoring'
         ELSE status
       END,
       implementation_summary =
         COALESCE($7, implementation_summary),
       implementation_evidence_reference =
         COALESCE($8, implementation_evidence_reference),
       implemented_at = CASE
         WHEN $7::text IS NOT NULL THEN NOW()
         ELSE implemented_at
       END,
       updated_at = NOW()
     WHERE id = $1 AND organization_id = $2
       AND status IN ('active', 'monitoring')
     RETURNING id`,
    [
      input.id,
      input.organizationId,
      input.ownerUserId ?? null,
      input.ownerName ?? null,
      input.remediationPlan ?? null,
      input.targetDate ?? null,
      input.implementationSummary ?? null,
      input.implementationEvidenceReference ?? null,
    ],
  );
  if (!result.rowCount) return null;
  await insertProgramEvent(client, {
    organizationId: input.organizationId,
    programId: input.id,
    actorUserId: input.actorUserId,
    actorName: input.actorName,
    eventType: input.implementationSummary
      ? "implementation_started"
      : "program_updated",
    details: {
      ownerName: input.ownerName,
      targetDate: input.targetDate,
      planUpdated: Boolean(input.remediationPlan),
      implementationEvidenceReference:
        input.implementationEvidenceReference,
    },
  });
  return result.rows[0];
}

export async function finalizeRemediationProgram(
  client: PoolClient,
  input: {
    id: string;
    organizationId: string;
    action: "verify" | "abandon";
    reason?: string;
    actorUserId: string;
    actorName: string;
  },
) {
  const result = await client.query<{ id: string }>(
    `UPDATE remediation_programs
     SET status = $3,
       verified_by_user_id = CASE
         WHEN $3 = 'verified' THEN $4::uuid ELSE NULL
       END,
       verified_by_name = CASE WHEN $3 = 'verified' THEN $5 ELSE NULL END,
       verified_at = CASE WHEN $3 = 'verified' THEN NOW() ELSE NULL END,
       abandoned_by_user_id = CASE
         WHEN $3 = 'abandoned' THEN $4::uuid ELSE NULL
       END,
       abandoned_by_name = CASE WHEN $3 = 'abandoned' THEN $5 ELSE NULL END,
       abandoned_reason = CASE WHEN $3 = 'abandoned' THEN $6 ELSE NULL END,
       abandoned_at = CASE WHEN $3 = 'abandoned' THEN NOW() ELSE NULL END,
       updated_at = NOW()
     WHERE id = $1 AND organization_id = $2
       AND (
         ($3 = 'verified' AND status = 'monitoring')
         OR ($3 = 'abandoned' AND status IN ('active', 'monitoring'))
       )
     RETURNING id`,
    [
      input.id,
      input.organizationId,
      input.action === "verify" ? "verified" : "abandoned",
      input.actorUserId,
      input.actorName,
      input.reason ?? null,
    ],
  );
  if (!result.rowCount) return null;
  await insertProgramEvent(client, {
    organizationId: input.organizationId,
    programId: input.id,
    actorUserId: input.actorUserId,
    actorName: input.actorName,
    eventType:
      input.action === "verify"
        ? "program_verified"
        : "program_abandoned",
    details: input.reason ? { reason: input.reason } : {},
  });
  return result.rows[0];
}

export async function linkProgramCasesForRun(
  client: PoolClient,
  organizationId: string,
  runId: string,
  actorName = "Deterministic recurrence matcher",
) {
  const linked = await client.query<{
    program_id: string;
    case_id: string;
  }>(
    `INSERT INTO remediation_program_cases (
       organization_id, program_id, case_id, link_type
     )
     SELECT payment_case.organization_id, program.id,
       payment_case.id, 'automatic'
     FROM operations_cases payment_case
     JOIN reconciliation_items item
       ON item.id = payment_case.item_id
      AND item.organization_id = payment_case.organization_id
     JOIN reconciliation_runs run
       ON run.id = payment_case.run_id
      AND run.organization_id = payment_case.organization_id
     JOIN remediation_programs program
       ON program.organization_id = payment_case.organization_id
      AND program.status IN ('active', 'monitoring')
      AND program.provider_id = run.provider_id
      AND LOWER(BTRIM(program.payment_mode)) =
        LOWER(BTRIM(item.payment_mode))
      AND program.reconciliation_status = item.reconciliation_status
      AND program.case_origin = payment_case.case_origin
     WHERE payment_case.organization_id = $1
       AND payment_case.run_id = $2
     ON CONFLICT DO NOTHING
     RETURNING program_id, case_id`,
    [organizationId, runId],
  );
  for (const item of linked.rows) {
    await insertProgramEvent(client, {
      organizationId,
      programId: item.program_id,
      actorUserId: null,
      actorName,
      eventType: "case_linked",
      details: { caseId: item.case_id, linkType: "automatic" },
    });
  }
  return linked.rows;
}

export async function linkProgramCasesByIds(
  client: PoolClient,
  organizationId: string,
  caseIds: string[],
) {
  if (!caseIds.length) return [];
  const linked = await client.query<{
    program_id: string;
    case_id: string;
  }>(
    `INSERT INTO remediation_program_cases (
       organization_id, program_id, case_id, link_type
     )
     SELECT payment_case.organization_id, program.id,
       payment_case.id, 'automatic'
     FROM operations_cases payment_case
     JOIN reconciliation_items item
       ON item.id = payment_case.item_id
      AND item.organization_id = payment_case.organization_id
     JOIN reconciliation_runs run
       ON run.id = payment_case.run_id
      AND run.organization_id = payment_case.organization_id
     JOIN remediation_programs program
       ON program.organization_id = payment_case.organization_id
      AND program.status IN ('active', 'monitoring')
      AND program.provider_id = run.provider_id
      AND LOWER(BTRIM(program.payment_mode)) =
        LOWER(BTRIM(item.payment_mode))
      AND program.reconciliation_status = item.reconciliation_status
      AND program.case_origin = payment_case.case_origin
     WHERE payment_case.organization_id = $1
       AND payment_case.id = ANY($2::uuid[])
     ON CONFLICT DO NOTHING
     RETURNING program_id, case_id`,
    [organizationId, caseIds],
  );
  for (const item of linked.rows) {
    await insertProgramEvent(client, {
      organizationId,
      programId: item.program_id,
      actorUserId: null,
      actorName: "Settlement recurrence matcher",
      eventType: "case_linked",
      details: { caseId: item.case_id, linkType: "automatic" },
    });
  }
  return linked.rows;
}

export async function listRemediationPrograms(
  organizationId: string,
  filters: RemediationFilters,
) {
  const result = await query<ProgramRow>(
    `SELECT program.*,
       TO_CHAR(program.target_date, 'YYYY-MM-DD') AS target_date_text
     FROM remediation_programs program
     WHERE program.organization_id = $1
       AND ($2::text = 'all' OR program.provider_id = $2)
       AND ($3::text = 'all' OR program.payment_mode = $3)
       AND ($4::text = 'all' OR program.status = $4)
     ORDER BY
       CASE program.status
         WHEN 'active' THEN 1 WHEN 'monitoring' THEN 2
         WHEN 'verified' THEN 3 ELSE 4
       END,
       program.target_date, program.updated_at DESC`,
    [
      organizationId,
      filters.provider,
      filters.paymentMode,
      filters.status,
    ],
  );
  return Promise.all(
    result.rows.map((row) => mapProgram(row, organizationId)),
  );
}

export async function getRemediationProgram(
  id: string,
  organizationId: string,
  client?: PoolClient,
) {
  const execute = client ? client.query.bind(client) : query;
  const result = await execute<ProgramRow>(
    `SELECT program.*,
       TO_CHAR(program.target_date, 'YYYY-MM-DD') AS target_date_text
     FROM remediation_programs program
     WHERE program.id = $1 AND program.organization_id = $2`,
    [id, organizationId],
  );
  return result.rows[0]
    ? mapProgram(result.rows[0], organizationId, client)
    : null;
}

type ProgramRow = {
  id: string;
  fingerprint: string;
  provider_id: ProviderId;
  payment_mode: string;
  reconciliation_status: RemediationProgram["reconciliationStatus"];
  case_origin: RemediationProgram["caseOrigin"];
  status: RemediationProgramStatus;
  owner_user_id: string;
  owner_name: string;
  remediation_plan: string;
  target_date_text: string;
  detection_window_start: Date;
  detection_window_end: Date;
  baseline_case_count: number;
  baseline_exposure: string;
  implementation_summary: string | null;
  implementation_evidence_reference: string | null;
  implemented_at: Date | null;
  verified_by_name: string | null;
  verified_at: Date | null;
  abandoned_by_name: string | null;
  abandoned_reason: string | null;
  abandoned_at: Date | null;
  created_by_name: string;
  created_at: Date;
  updated_at: Date;
};

async function mapProgram(
  row: ProgramRow,
  organizationId: string,
  client?: PoolClient,
): Promise<RemediationProgram> {
  const linkedCases = await listLinkedCases(
    row.id,
    organizationId,
    client,
  );
  const cleanRuns = row.implemented_at
    ? await listCleanRuns(row, organizationId, client)
    : [];
  const events = await listProgramEvents(
    row.id,
    organizationId,
    client,
  );
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    providerId: row.provider_id,
    paymentMode: row.payment_mode,
    reconciliationStatus: row.reconciliation_status,
    caseOrigin: row.case_origin,
    status: row.status,
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name,
    remediationPlan: row.remediation_plan,
    targetDate: row.target_date_text,
    detectionWindowStart: row.detection_window_start.toISOString(),
    detectionWindowEnd: row.detection_window_end.toISOString(),
    baselineCaseCount: row.baseline_case_count,
    baselineExposure: Number(row.baseline_exposure),
    implementationSummary: row.implementation_summary,
    implementationEvidenceReference:
      row.implementation_evidence_reference,
    implementedAt: row.implemented_at?.toISOString() ?? null,
    verifiedByName: row.verified_by_name,
    verifiedAt: row.verified_at?.toISOString() ?? null,
    abandonedByName: row.abandoned_by_name,
    abandonedReason: row.abandoned_reason,
    abandonedAt: row.abandoned_at?.toISOString() ?? null,
    createdByName: row.created_by_name,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    linkedCases,
    cleanRuns,
    events,
  };
}

async function listLinkedCases(
  programId: string,
  organizationId: string,
  client?: PoolClient,
): Promise<RemediationProgramCase[]> {
  const execute = client ? client.query.bind(client) : query;
  const result = await execute<{
    id: string;
    order_id: string;
    priority: RemediationProgramCase["priority"];
    case_status: RemediationProgramCase["status"];
    variance: string;
    order_amount: string;
    reconciliation_status: RemediationProgram["reconciliationStatus"];
    due_at: Date;
    resolved_at: Date | null;
    link_type: RemediationProgramCase["linkType"];
    linked_at: Date;
  }>(
    `SELECT payment_case.id, item.order_id, payment_case.priority,
       payment_case.case_status, item.variance, item.order_amount,
       item.reconciliation_status, payment_case.due_at,
       payment_case.resolved_at, link.link_type, link.linked_at
     FROM remediation_program_cases link
     JOIN operations_cases payment_case
       ON payment_case.id = link.case_id
      AND payment_case.organization_id = link.organization_id
     JOIN reconciliation_items item
       ON item.id = payment_case.item_id
      AND item.organization_id = payment_case.organization_id
     WHERE link.program_id = $1 AND link.organization_id = $2
     ORDER BY link.linked_at DESC`,
    [programId, organizationId],
  );
  return result.rows.map((item) => ({
    id: item.id,
    orderId: item.order_id,
    priority: item.priority,
    status: item.case_status,
    exposure:
      item.reconciliation_status === "amount_mismatch"
        ? Math.abs(Number(item.variance))
        : Math.abs(Number(item.order_amount)),
    dueAt: item.due_at.toISOString(),
    resolvedAt: item.resolved_at?.toISOString() ?? null,
    linkType: item.link_type,
    linkedAt: item.linked_at.toISOString(),
  }));
}

async function listCleanRuns(
  program: ProgramRow,
  organizationId: string,
  client?: PoolClient,
): Promise<RemediationCleanRun[]> {
  const execute = client ? client.query.bind(client) : query;
  const result = await execute<{
    run_id: string;
    run_name: string;
    created_at: Date;
    qualifying_items: number;
    recurring_exceptions: number;
  }>(
    `SELECT run.id AS run_id, run.name AS run_name, run.created_at,
       COUNT(item.id)::int AS qualifying_items,
       COUNT(*) FILTER (
         WHERE item.reconciliation_status = $5
           AND (
             $6::text <> 'settlement_overdue'
             OR item.expected_settlement_at < run.created_at
           )
       )::int AS recurring_exceptions
     FROM reconciliation_runs run
     JOIN reconciliation_items item
       ON item.run_id = run.id AND item.organization_id = run.organization_id
     WHERE run.organization_id = $1
       AND run.status = 'completed'
       AND run.created_at > $2
       AND run.provider_id = $3
       AND LOWER(BTRIM(item.payment_mode)) = LOWER(BTRIM($4))
     GROUP BY run.id, run.name, run.created_at
     ORDER BY run.created_at ASC`,
    [
      organizationId,
      program.implemented_at,
      program.provider_id,
      program.payment_mode,
      program.reconciliation_status,
      program.case_origin,
    ],
  );
  return result.rows.map((item) => ({
    runId: item.run_id,
    runName: item.run_name,
    createdAt: item.created_at.toISOString(),
    qualifyingItems: item.qualifying_items,
    recurringExceptions: item.recurring_exceptions,
    clean: item.recurring_exceptions === 0,
  }));
}

async function listProgramEvents(
  programId: string,
  organizationId: string,
  client?: PoolClient,
): Promise<RemediationProgramEvent[]> {
  const execute = client ? client.query.bind(client) : query;
  const result = await execute<{
    id: string;
    event_type: RemediationProgramEvent["eventType"];
    actor_name: string;
    details: Record<string, unknown>;
    created_at: Date;
  }>(
    `SELECT id, event_type, actor_name, details, created_at
     FROM remediation_program_events
     WHERE program_id = $1 AND organization_id = $2
     ORDER BY created_at DESC`,
    [programId, organizationId],
  );
  return result.rows.map((item) => ({
    id: item.id,
    eventType: item.event_type,
    actorName: item.actor_name,
    details: item.details,
    createdAt: item.created_at.toISOString(),
  }));
}

async function insertProgramEvent(
  client: PoolClient,
  input: {
    organizationId: string;
    programId: string;
    actorUserId: string | null;
    actorName: string;
    eventType: RemediationProgramEvent["eventType"];
    details: Record<string, unknown>;
  },
) {
  await client.query(
    `INSERT INTO remediation_program_events (
       organization_id, program_id, actor_user_id, actor_name,
       event_type, details
     ) VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      input.organizationId,
      input.programId,
      input.actorUserId,
      input.actorName,
      input.eventType,
      JSON.stringify(input.details),
    ],
  );
}
