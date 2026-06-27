import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import type {
  SourceArrivalClassification,
  SourceIngestionArrival,
  SourceIngestionEvent,
  SourceIngestionExpectation,
  SourceIngestionProviderId,
  SourceIngestionSource,
  SourceKind,
  SourceTransportType,
  SourceValidationStatus,
  DownstreamWorkflow,
  ExpectedFrequency,
  SourceIngestionVersionDetail,
  SourceReadinessSnapshot,
} from "@/lib/modules/source-ingestion/types";

function mapSource(row: SourceRow): SourceIngestionSource {
  return {
    id: row.id,
    sourceKey: row.source_key,
    displayName: row.display_name,
    providerId: row.provider_id,
    sourceKind: row.source_kind,
    transportType: row.transport_type,
    expectedFrequency: row.expected_frequency,
    ownerTeam: row.owner_team,
    active: row.active,
    evidence: row.evidence ?? {},
  };
}

function mapArrival(row: ArrivalRow): SourceIngestionArrival {
  return {
    id: row.id,
    versionNumber: row.version_number,
    expectationId: row.expectation_id,
    sourceId: row.source_id,
    fileName: row.file_name,
    fileHash: row.file_hash,
    sourceRowCount: row.source_row_count,
    acceptedRowCount: row.accepted_row_count,
    rejectedRowCount: row.rejected_row_count,
    receivedAt: toIsoTimestamp(row.received_at),
    supersedesArrivalId: row.supersedes_arrival_id,
    classification: row.classification,
    validationStatus: row.validation_status,
    downstreamWorkflow: row.downstream_workflow,
    linkedReconciliationRunId: row.linked_reconciliation_run_id,
    linkedSettlementImportId: row.linked_settlement_import_id,
    evidence: row.evidence ?? {},
    review: row.reviewed_at
      ? {
          reviewedAt: toIsoTimestamp(row.reviewed_at),
          reviewedByUserId: row.reviewed_by_user_id,
          reviewedByName: row.reviewed_by_name ?? "Unknown user",
          reason: row.review_reason ?? "",
        }
      : null,
  };
}

function mapExpectation(row: ExpectationRow): SourceIngestionExpectation {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceKey: row.source_key,
    displayName: row.display_name,
    providerId: row.provider_id,
    sourceKind: row.source_kind,
    transportType: row.transport_type,
    ownerTeam: row.owner_team,
    businessDate: toDateString(row.business_date),
    expectedArrivalAt: toIsoTimestamp(row.expected_arrival_at),
    graceMinutes: row.grace_minutes,
    requiredForClose: row.required_for_close,
    expectedFilenamePattern: row.expected_filename_pattern,
    status: row.status,
    latestArrival: row.arrival_id
      ? mapArrival({
          id: row.arrival_id,
          version_number: row.version_number ?? 1,
          expectation_id: row.id,
          source_id: row.source_id,
          file_name: row.file_name ?? "",
          file_hash: row.file_hash ?? "",
          source_row_count: row.source_row_count ?? 0,
          accepted_row_count: row.accepted_row_count ?? 0,
          rejected_row_count: row.rejected_row_count ?? 0,
          received_at: row.received_at ?? new Date(0),
          supersedes_arrival_id: row.supersedes_arrival_id ?? null,
          classification: row.classification ?? "on_time",
          validation_status: row.validation_status ?? "accepted",
          downstream_workflow: row.downstream_workflow ?? "manual_review",
          linked_reconciliation_run_id: row.linked_reconciliation_run_id ?? null,
          linked_settlement_import_id: row.linked_settlement_import_id ?? null,
          evidence: row.arrival_evidence ?? {},
          reviewed_at: row.reviewed_at ?? null,
          reviewed_by_user_id: row.reviewed_by_user_id ?? null,
          reviewed_by_name: row.reviewed_by_name ?? null,
          review_reason: row.review_reason ?? null,
        })
      : null,
    arrivals: [],
  };
}

function mapEvent(row: EventRow): SourceIngestionEvent {
  return {
    id: row.id,
    sourceId: row.source_id,
    expectationId: row.expectation_id,
    arrivalId: row.arrival_id,
    actorName: row.actor_name,
    eventType: row.event_type,
    details: row.details ?? {},
    createdAt: toIsoTimestamp(row.created_at),
  };
}

export async function lockSourceIngestion(
  client: PoolClient,
  organizationId: string,
) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 21021))", [
    organizationId,
  ]);
}

export async function listSourceIngestionWorkspace(
  organizationId: string,
  businessDate: string,
) {
  const expectations = await query<ExpectationRow>(
    `SELECT expectation.id,
       expectation.source_id,
       expectation.business_date,
       expectation.expected_arrival_at,
       expectation.grace_minutes,
       expectation.required_for_close,
       expectation.expected_filename_pattern,
       expectation.status,
       source.source_key,
       source.display_name,
       source.provider_id,
       source.source_kind,
       source.transport_type,
       source.owner_team,
       arrival.id AS arrival_id,
       arrival.version_number,
       arrival.file_name,
       arrival.file_hash,
       arrival.source_row_count,
       arrival.accepted_row_count,
       arrival.rejected_row_count,
       arrival.received_at,
       arrival.supersedes_arrival_id,
       arrival.classification,
       arrival.validation_status,
       arrival.downstream_workflow,
       arrival.linked_reconciliation_run_id,
       arrival.linked_settlement_import_id,
       arrival.evidence AS arrival_evidence,
       arrival.reviewed_at, arrival.reviewed_by_user_id,
       arrival.reviewed_by_name, arrival.review_reason
     FROM source_ingestion_expectations expectation
     JOIN source_ingestion_sources source
       ON source.id = expectation.source_id
      AND source.organization_id = expectation.organization_id
     LEFT JOIN LATERAL (
       SELECT *
       FROM source_ingestion_arrivals candidate
       WHERE candidate.organization_id = expectation.organization_id
         AND candidate.expectation_id = expectation.id
       ORDER BY candidate.received_at DESC, candidate.created_at DESC
       LIMIT 1
     ) arrival ON TRUE
     WHERE expectation.organization_id = $1
       AND expectation.business_date = $2::date
     ORDER BY expectation.required_for_close DESC,
       expectation.expected_arrival_at,
       source.source_kind`,
    [organizationId, businessDate],
  );

  const events = await query<EventRow>(
    `SELECT id, source_id, expectation_id, arrival_id, actor_name, event_type,
       details, created_at
     FROM source_ingestion_events
     WHERE organization_id = $1
     ORDER BY created_at DESC
     LIMIT 30`,
    [organizationId],
  );

  const arrivals = await query<ArrivalRow>(
    `SELECT arrival.* FROM source_ingestion_arrivals arrival
     JOIN source_ingestion_expectations expectation
       ON expectation.id = arrival.expectation_id
      AND expectation.organization_id = arrival.organization_id
     WHERE arrival.organization_id = $1
       AND expectation.business_date = $2::date
     ORDER BY arrival.expectation_id, arrival.version_number DESC`,
    [organizationId, businessDate],
  );
  const snapshots = await listReadinessSnapshots(organizationId, businessDate);
  const mappedExpectations = expectations.rows.map(mapExpectation);
  for (const expectation of mappedExpectations) {
    expectation.arrivals = arrivals.rows
      .filter((arrival) => arrival.expectation_id === expectation.id)
      .map(mapArrival);
  }

  return {
    expectations: mappedExpectations,
    events: events.rows.map(mapEvent) satisfies SourceIngestionEvent[],
    latestSnapshot: snapshots[0] ?? null,
  };
}

export async function listSources(
  client: PoolClient,
  organizationId: string,
) {
  const result = await client.query<SourceRow>(
    `SELECT id, source_key, display_name, provider_id, source_kind,
       transport_type, expected_frequency, owner_team, active, evidence
     FROM source_ingestion_sources
     WHERE organization_id = $1 AND active = TRUE
     ORDER BY source_kind, display_name`,
    [organizationId],
  );
  return result.rows.map(mapSource);
}

export async function upsertSource(
  client: PoolClient,
  input: {
    organizationId: string;
    sourceKey: string;
    displayName: string;
    providerId: SourceIngestionProviderId;
    sourceKind: SourceKind;
    transportType: SourceTransportType;
    expectedFrequency: ExpectedFrequency;
    ownerTeam: string;
    evidence: Record<string, unknown>;
    seedMarker?: string | null;
  },
) {
  const result = await client.query<{ id: string }>(
    `INSERT INTO source_ingestion_sources (
       organization_id, source_key, display_name, provider_id, source_kind,
       transport_type, expected_frequency, owner_team, evidence, seed_marker
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (organization_id, source_key)
     DO UPDATE SET
       display_name = EXCLUDED.display_name,
       provider_id = EXCLUDED.provider_id,
       source_kind = EXCLUDED.source_kind,
       transport_type = EXCLUDED.transport_type,
       expected_frequency = EXCLUDED.expected_frequency,
       owner_team = EXCLUDED.owner_team,
       active = TRUE,
       evidence = EXCLUDED.evidence,
       seed_marker = EXCLUDED.seed_marker,
       updated_at = NOW()
     RETURNING id`,
    [
      input.organizationId,
      input.sourceKey,
      input.displayName,
      input.providerId,
      input.sourceKind,
      input.transportType,
      input.expectedFrequency,
      input.ownerTeam,
      JSON.stringify(input.evidence),
      input.seedMarker ?? null,
    ],
  );
  return result.rows[0].id;
}

export async function upsertExpectation(
  client: PoolClient,
  input: {
    organizationId: string;
    sourceId: string;
    businessDate: string;
    expectedArrivalAt: string;
    graceMinutes: number;
    requiredForClose: boolean;
    expectedFilenamePattern: string;
    status: "expected" | "missing" | "waived";
    seedMarker?: string | null;
  },
) {
  const result = await client.query<{ id: string }>(
    `INSERT INTO source_ingestion_expectations (
       organization_id, source_id, business_date, expected_arrival_at,
       grace_minutes, required_for_close, expected_filename_pattern,
       status, seed_marker
     ) VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (organization_id, source_id, business_date)
     DO UPDATE SET
       expected_arrival_at = EXCLUDED.expected_arrival_at,
       grace_minutes = EXCLUDED.grace_minutes,
       required_for_close = EXCLUDED.required_for_close,
       expected_filename_pattern = EXCLUDED.expected_filename_pattern,
       status = EXCLUDED.status,
       seed_marker = EXCLUDED.seed_marker,
       updated_at = NOW()
     RETURNING id`,
    [
      input.organizationId,
      input.sourceId,
      input.businessDate,
      input.expectedArrivalAt,
      input.graceMinutes,
      input.requiredForClose,
      input.expectedFilenamePattern,
      input.status,
      input.seedMarker ?? null,
    ],
  );
  return result.rows[0].id;
}

export async function getExpectationForUpload(
  client: PoolClient,
  organizationId: string,
  expectationId: string,
) {
  const result = await client.query<ExpectationRow>(
    `SELECT expectation.id,
       expectation.source_id,
       expectation.business_date,
       expectation.expected_arrival_at,
       expectation.grace_minutes,
       expectation.required_for_close,
       expectation.expected_filename_pattern,
       expectation.status,
       source.source_key,
       source.display_name,
       source.provider_id,
       source.source_kind,
       source.transport_type,
       source.owner_team
     FROM source_ingestion_expectations expectation
     JOIN source_ingestion_sources source
       ON source.id = expectation.source_id
      AND source.organization_id = expectation.organization_id
     WHERE expectation.organization_id = $1
       AND expectation.id = $2`,
    [organizationId, expectationId],
  );
  return result.rows[0] ? mapExpectation(result.rows[0]) : null;
}

export async function findArrivalByHash(
  client: PoolClient,
  organizationId: string,
  sourceId: string,
  fileHash: string,
) {
  const result = await client.query<{ id: string }>(
    `SELECT id
     FROM source_ingestion_arrivals
     WHERE organization_id = $1
       AND source_id = $2
       AND file_hash = $3
     LIMIT 1`,
    [organizationId, sourceId, fileHash],
  );
  return result.rows[0]?.id ?? null;
}

export async function findLatestArrival(
  client: PoolClient,
  organizationId: string,
  expectationId: string,
) {
  const result = await client.query<{ id: string; file_hash: string }>(
    `SELECT id, file_hash
     FROM source_ingestion_arrivals
     WHERE organization_id = $1
       AND expectation_id = $2
     ORDER BY received_at DESC, created_at DESC
     LIMIT 1`,
    [organizationId, expectationId],
  );
  return result.rows[0] ?? null;
}

const arrivalColumns = `arrival.id, arrival.expectation_id, arrival.source_id,
  arrival.version_number,
  arrival.file_name, arrival.file_hash, arrival.source_row_count,
  arrival.accepted_row_count, arrival.rejected_row_count, arrival.received_at,
  arrival.supersedes_arrival_id, arrival.classification, arrival.validation_status,
  arrival.downstream_workflow, arrival.linked_reconciliation_run_id,
  arrival.linked_settlement_import_id, arrival.evidence, arrival.reviewed_at,
  arrival.reviewed_by_user_id, arrival.reviewed_by_name, arrival.review_reason`;

export async function getSourceIngestionVersion(
  organizationId: string,
  arrivalId: string,
): Promise<SourceIngestionVersionDetail | null> {
  const result = await query<ArrivalRow & SourceRow & {
    business_date: Date | string; expected_arrival_at: Date | string;
    grace_minutes: number; required_for_close: boolean;
    expected_filename_pattern: string; status: SourceIngestionExpectation["status"];
  }>(
    `SELECT ${arrivalColumns}, source.source_key, source.display_name,
       source.provider_id, source.source_kind, source.transport_type,
       source.expected_frequency, source.owner_team, source.active,
       source.evidence AS source_evidence, expectation.business_date,
       expectation.expected_arrival_at, expectation.grace_minutes,
       expectation.required_for_close, expectation.expected_filename_pattern,
       expectation.status
     FROM source_ingestion_arrivals arrival
     JOIN source_ingestion_sources source ON source.id = arrival.source_id
       AND source.organization_id = arrival.organization_id
     JOIN source_ingestion_expectations expectation ON expectation.id = arrival.expectation_id
       AND expectation.organization_id = arrival.organization_id
     WHERE arrival.organization_id = $1 AND arrival.id = $2`,
    [organizationId, arrivalId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const [lineageResult, eventsResult] = await Promise.all([
    query<ArrivalRow>(
      `SELECT history.* FROM source_ingestion_arrivals history
       JOIN source_ingestion_arrivals selected
         ON selected.organization_id = history.organization_id
        AND selected.expectation_id = history.expectation_id
       WHERE selected.organization_id = $1 AND selected.id = $2
       ORDER BY history.version_number DESC`,
      [organizationId, arrivalId],
    ),
    query<EventRow>(
      `SELECT id, source_id, expectation_id, arrival_id, actor_name, event_type,
         details, created_at FROM source_ingestion_events
       WHERE organization_id = $1 AND arrival_id = $2 ORDER BY created_at`,
      [organizationId, arrivalId],
    ),
  ]);
  const arrival = mapArrival(row);
  return {
    arrival,
    source: mapSource({ ...row, evidence: (row as unknown as { source_evidence: Record<string, unknown> }).source_evidence }),
    expectation: {
      id: arrival.expectationId, sourceId: arrival.sourceId, sourceKey: row.source_key,
      displayName: row.display_name, providerId: row.provider_id,
      sourceKind: row.source_kind, transportType: row.transport_type,
      ownerTeam: row.owner_team, businessDate: toDateString(row.business_date),
      expectedArrivalAt: toIsoTimestamp(row.expected_arrival_at), graceMinutes: row.grace_minutes,
      requiredForClose: row.required_for_close,
      expectedFilenamePattern: row.expected_filename_pattern, status: row.status,
      arrivals: lineageResult.rows.map(mapArrival),
    },
    lineage: lineageResult.rows.map(mapArrival),
    events: eventsResult.rows.map(mapEvent),
    acceptedSourceContract: arrival.validationStatus === "accepted" ? {
      contractVersion: "accepted-source-v1",
      arrivalId: arrival.id,
      organizationScoped: true,
      workflow: arrival.downstreamWorkflow,
      fileHash: arrival.fileHash,
      rowCount: arrival.acceptedRowCount,
      acceptedAt: arrival.review?.reviewedAt ?? arrival.receivedAt,
      acceptedByName: arrival.review?.reviewedByName ?? "Deterministic intake policy",
      reason: arrival.review?.reason ?? "Passed deterministic source validation.",
    } : null,
  };
}

export async function getArrivalForReview(
  client: PoolClient, organizationId: string, arrivalId: string,
) {
  const result = await client.query<ArrivalRow>(
    `SELECT ${arrivalColumns} FROM source_ingestion_arrivals arrival
     WHERE arrival.organization_id = $1 AND arrival.id = $2 FOR UPDATE`,
    [organizationId, arrivalId],
  );
  return result.rows[0] ? mapArrival(result.rows[0]) : null;
}

export async function reviewArrival(client: PoolClient, input: {
  organizationId: string; arrivalId: string; status: "accepted" | "rejected";
  actorUserId: string; actorName: string; reason: string;
}) {
  const result = await client.query<ArrivalRow>(
    `UPDATE source_ingestion_arrivals arrival SET validation_status = $3,
       accepted_row_count = CASE WHEN $3 = 'accepted' THEN source_row_count ELSE 0 END,
       rejected_row_count = CASE WHEN $3 = 'rejected' THEN source_row_count ELSE 0 END,
       downstream_workflow = CASE WHEN $3 = 'rejected' THEN 'manual_review'
         WHEN (SELECT source_kind FROM source_ingestion_sources
               WHERE organization_id = $1 AND id = arrival.source_id) = 'settlement_statement'
           THEN 'settlement_import'
         WHEN (SELECT source_kind FROM source_ingestion_sources
               WHERE organization_id = $1 AND id = arrival.source_id) = 'bank_statement'
           THEN 'close_control'
         ELSE 'reconciliation' END,
       reviewed_at = NOW(), reviewed_by_user_id = $4,
       reviewed_by_name = $5, review_reason = $6
     WHERE organization_id = $1 AND id = $2 AND validation_status = 'needs_review'
     RETURNING ${arrivalColumns}`,
    [input.organizationId, input.arrivalId, input.status,
      input.actorUserId, input.actorName, input.reason],
  );
  return result.rows[0] ? mapArrival(result.rows[0]) : null;
}

export async function insertReadinessSnapshot(client: PoolClient, input: {
  organizationId: string; summary: import("./types").SourceReadinessSummary;
  blockingExpectationIds: string[]; actorUserId: string; actorName: string;
}) {
  const s = input.summary;
  const result = await client.query<ReadinessSnapshotRow>(
    `INSERT INTO source_ingestion_readiness_snapshots (
       organization_id, business_date, verdict, expected_files, accepted_files,
       missing_files, late_files, quarantined_files, blocking_files,
       optional_warnings, blocking_expectation_ids, created_by_user_id, created_by_name
     ) VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [input.organizationId, s.businessDate, s.verdict, s.expectedFiles, s.acceptedFiles,
      s.missingFiles, s.lateFiles, s.quarantinedFiles, s.blockingFiles,
      s.optionalWarnings, JSON.stringify(input.blockingExpectationIds),
      input.actorUserId, input.actorName],
  );
  return mapSnapshot(result.rows[0]);
}

export async function listReadinessSnapshots(organizationId: string, businessDate: string) {
  const result = await query<ReadinessSnapshotRow>(
    `SELECT * FROM source_ingestion_readiness_snapshots
     WHERE organization_id = $1 AND business_date = $2::date
     ORDER BY created_at DESC LIMIT 50`, [organizationId, businessDate]);
  return result.rows.map(mapSnapshot);
}

export async function insertArrival(
  client: PoolClient,
  input: {
    organizationId: string;
    expectationId: string;
    sourceId: string;
    fileName: string;
    fileHash: string;
    sourceRowCount: number;
    acceptedRowCount: number;
    rejectedRowCount: number;
    receivedAt: string;
    supersedesArrivalId: string | null;
    classification: SourceArrivalClassification;
    validationStatus: SourceValidationStatus;
    downstreamWorkflow: DownstreamWorkflow;
    evidence: Record<string, unknown>;
    seedMarker?: string | null;
  },
) {
  const version = await client.query<{ next_version: number }>(
    `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
     FROM source_ingestion_arrivals
     WHERE organization_id = $1 AND expectation_id = $2`,
    [input.organizationId, input.expectationId],
  );
  const result = await client.query<{ id: string }>(
    `INSERT INTO source_ingestion_arrivals (
       organization_id, expectation_id, source_id, version_number, file_name, file_hash,
       source_row_count, accepted_row_count, rejected_row_count, received_at,
       supersedes_arrival_id, classification, validation_status,
       downstream_workflow, evidence, seed_marker
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING id`,
    [
      input.organizationId,
      input.expectationId,
      input.sourceId,
      version.rows[0].next_version,
      input.fileName,
      input.fileHash,
      input.sourceRowCount,
      input.acceptedRowCount,
      input.rejectedRowCount,
      input.receivedAt,
      input.supersedesArrivalId,
      input.classification,
      input.validationStatus,
      input.downstreamWorkflow,
      JSON.stringify(input.evidence),
      input.seedMarker ?? null,
    ],
  );
  return result.rows[0].id;
}

export async function updateExpectationStatus(
  client: PoolClient,
  organizationId: string,
  expectationId: string,
  status: "arrived" | "late" | "missing" | "waived",
) {
  await client.query(
    `UPDATE source_ingestion_expectations
     SET status = $3, updated_at = NOW()
     WHERE organization_id = $1 AND id = $2`,
    [organizationId, expectationId, status],
  );
}

export async function insertSourceIngestionEvent(
  client: PoolClient,
  input: {
    organizationId: string;
    sourceId?: string | null;
    expectationId?: string | null;
    arrivalId?: string | null;
    actorUserId?: string | null;
    actorName: string;
    eventType: SourceIngestionEvent["eventType"];
    details: Record<string, unknown>;
  },
) {
  await client.query(
    `INSERT INTO source_ingestion_events (
       organization_id, source_id, expectation_id, arrival_id,
       actor_user_id, actor_name, event_type, details
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      input.organizationId,
      input.sourceId ?? null,
      input.expectationId ?? null,
      input.arrivalId ?? null,
      input.actorUserId ?? null,
      input.actorName,
      input.eventType,
      JSON.stringify(input.details),
    ],
  );
}

export async function deleteSeedSourceIngestionData(
  client: PoolClient,
  organizationId: string,
  seedMarker: string,
) {
  await client.query(
    `DELETE FROM source_ingestion_events
     WHERE organization_id = $1
       AND details->>'seedMarker' = $2`,
    [organizationId, seedMarker],
  );
  await client.query(
    `DELETE FROM source_ingestion_arrivals
     WHERE organization_id = $1 AND seed_marker = $2`,
    [organizationId, seedMarker],
  );
  await client.query(
    `DELETE FROM source_ingestion_expectations
     WHERE organization_id = $1 AND seed_marker = $2`,
    [organizationId, seedMarker],
  );
  await client.query(
    `DELETE FROM source_ingestion_sources
     WHERE organization_id = $1 AND seed_marker = $2`,
    [organizationId, seedMarker],
  );
}

type SourceRow = {
  id: string;
  source_key: string;
  display_name: string;
  provider_id: SourceIngestionProviderId;
  source_kind: SourceKind;
  transport_type: SourceTransportType;
  expected_frequency: ExpectedFrequency;
  owner_team: string;
  active: boolean;
  evidence: Record<string, unknown>;
};

function toIsoTimestamp(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toDateString(value: Date | string) {
  if (!(value instanceof Date)) return value.slice(0, 10);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

type ArrivalRow = {
  id: string;
  version_number: number;
  expectation_id: string;
  source_id: string;
  file_name: string;
  file_hash: string;
  source_row_count: number;
  accepted_row_count: number;
  rejected_row_count: number;
  received_at: Date | string;
  supersedes_arrival_id: string | null;
  classification: SourceArrivalClassification;
  validation_status: SourceValidationStatus;
  downstream_workflow: DownstreamWorkflow;
  linked_reconciliation_run_id: string | null;
  linked_settlement_import_id: string | null;
  evidence: SourceIngestionArrival["evidence"];
  reviewed_at: Date | string | null;
  reviewed_by_user_id: string | null;
  reviewed_by_name: string | null;
  review_reason: string | null;
};

type ExpectationRow = {
  id: string;
  source_id: string;
  business_date: Date | string;
  expected_arrival_at: Date | string;
  grace_minutes: number;
  required_for_close: boolean;
  expected_filename_pattern: string;
  status: SourceIngestionExpectation["status"];
  source_key: string;
  display_name: string;
  provider_id: SourceIngestionProviderId;
  source_kind: SourceKind;
  transport_type: SourceTransportType;
  owner_team: string;
  arrival_id?: string | null;
  version_number?: number | null;
  file_name?: string | null;
  file_hash?: string | null;
  source_row_count?: number | null;
  accepted_row_count?: number | null;
  rejected_row_count?: number | null;
  received_at?: Date | string | null;
  supersedes_arrival_id?: string | null;
  classification?: SourceArrivalClassification | null;
  validation_status?: SourceValidationStatus | null;
  downstream_workflow?: DownstreamWorkflow | null;
  linked_reconciliation_run_id?: string | null;
  linked_settlement_import_id?: string | null;
  arrival_evidence?: SourceIngestionArrival["evidence"] | null;
  reviewed_at?: Date | string | null;
  reviewed_by_user_id?: string | null;
  reviewed_by_name?: string | null;
  review_reason?: string | null;
};

type EventRow = {
  id: string;
  source_id: string | null;
  expectation_id: string | null;
  arrival_id: string | null;
  actor_name: string;
  event_type: SourceIngestionEvent["eventType"];
  details: Record<string, unknown>;
  created_at: Date | string;
};

type ReadinessSnapshotRow = {
  id: string;
  business_date: Date | string;
  verdict: SourceReadinessSnapshot["verdict"];
  expected_files: number;
  accepted_files: number;
  missing_files: number;
  late_files: number;
  quarantined_files: number;
  blocking_files: number;
  optional_warnings: number;
  blocking_expectation_ids: string[];
  created_by_user_id: string | null;
  created_by_name: string;
  created_at: Date | string;
};

function mapSnapshot(row: ReadinessSnapshotRow): SourceReadinessSnapshot {
  return {
    id: row.id,
    businessDate: toDateString(row.business_date),
    verdict: row.verdict,
    expectedFiles: row.expected_files,
    acceptedFiles: row.accepted_files,
    missingFiles: row.missing_files,
    lateFiles: row.late_files,
    quarantinedFiles: row.quarantined_files,
    blockingFiles: row.blocking_files,
    optionalWarnings: row.optional_warnings,
    blockingExpectationIds: row.blocking_expectation_ids,
    createdByUserId: row.created_by_user_id,
    createdByName: row.created_by_name,
    createdAt: toIsoTimestamp(row.created_at),
  };
}
