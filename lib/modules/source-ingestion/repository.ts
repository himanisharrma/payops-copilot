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
        })
      : null,
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
       arrival.evidence AS arrival_evidence
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

  return {
    expectations: expectations.rows.map(mapExpectation),
    events: events.rows.map((row) => ({
      id: row.id,
      sourceId: row.source_id,
      expectationId: row.expectation_id,
      arrivalId: row.arrival_id,
      actorName: row.actor_name,
      eventType: row.event_type,
      details: row.details ?? {},
      createdAt: toIsoTimestamp(row.created_at),
    })) satisfies SourceIngestionEvent[],
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

export async function findLatestAcceptedArrival(
  client: PoolClient,
  organizationId: string,
  expectationId: string,
) {
  const result = await client.query<{ id: string; file_hash: string }>(
    `SELECT id, file_hash
     FROM source_ingestion_arrivals
     WHERE organization_id = $1
       AND expectation_id = $2
       AND validation_status = 'accepted'
     ORDER BY received_at DESC, created_at DESC
     LIMIT 1`,
    [organizationId, expectationId],
  );
  return result.rows[0] ?? null;
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
  const result = await client.query<{ id: string }>(
    `INSERT INTO source_ingestion_arrivals (
       organization_id, expectation_id, source_id, file_name, file_hash,
       source_row_count, accepted_row_count, rejected_row_count, received_at,
       supersedes_arrival_id, classification, validation_status,
       downstream_workflow, evidence, seed_marker
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING id`,
    [
      input.organizationId,
      input.expectationId,
      input.sourceId,
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
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

type ArrivalRow = {
  id: string;
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
