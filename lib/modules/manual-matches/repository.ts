import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import type {
  ManualMatchEvent,
  ManualMatchEventType,
  ManualMatchProposal,
  ManualMatchProposalStatus,
  ManualMatchProposalType,
} from "@/lib/modules/manual-matches/types";
import type { MatchConfidence, MatchStrategy, ReasonCode } from "@/lib/types";

export type ReconciliationItemForOverride = {
  itemId: string;
  runId: string;
  reconciliationStatus: string;
  matchStrategy: MatchStrategy | null;
  matchConfidence: MatchConfidence | null;
  reasonCode: ReasonCode | null;
};

export async function getReconciliationItemForOverride(
  client: PoolClient,
  organizationId: string,
  itemId: string,
): Promise<ReconciliationItemForOverride | null> {
  const result = await client.query<{
    id: string;
    run_id: string;
    reconciliation_status: string;
    match_strategy: MatchStrategy | null;
    match_confidence: MatchConfidence | null;
    reason_code: ReasonCode | null;
  }>(
    `SELECT id, run_id, reconciliation_status,
       match_strategy, match_confidence, reason_code
     FROM reconciliation_items
     WHERE organization_id = $1 AND id = $2
     FOR UPDATE`,
    [organizationId, itemId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    itemId: row.id,
    runId: row.run_id,
    reconciliationStatus: row.reconciliation_status,
    matchStrategy: row.match_strategy,
    matchConfidence: row.match_confidence,
    reasonCode: row.reason_code,
  };
}

type ProposalRow = {
  id: string;
  item_id: string;
  run_id: string;
  proposal_type: ManualMatchProposalType;
  status: ManualMatchProposalStatus;
  reason: string;
  proposed_by_user_id: string | null;
  proposed_by_name: string;
  decided_by_user_id: string | null;
  decided_by_name: string | null;
  decision_reason: string | null;
  decided_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export async function insertManualMatchProposal(
  client: PoolClient,
  input: {
    organizationId: string;
    itemId: string;
    runId: string;
    proposalType: ManualMatchProposalType;
    status: ManualMatchProposalStatus;
    reason: string;
    proposedByUserId: string | null;
    proposedByName: string;
  },
) {
  const result = await client.query<{ id: string }>(
    `INSERT INTO manual_match_proposals (
       organization_id, item_id, run_id, proposal_type, status,
       reason, evidence_confirmed, proposed_by_user_id, proposed_by_name
     ) VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7,$8)
     RETURNING id`,
    [
      input.organizationId,
      input.itemId,
      input.runId,
      input.proposalType,
      input.status,
      input.reason,
      input.proposedByUserId,
      input.proposedByName,
    ],
  );
  return result.rows[0].id;
}

export async function getProposalForUpdate(
  client: PoolClient,
  organizationId: string,
  proposalId: string,
) {
  const result = await client.query<ProposalRow>(
    `SELECT id, item_id, run_id, proposal_type, status, reason,
       proposed_by_user_id, proposed_by_name,
       decided_by_user_id, decided_by_name, decision_reason, decided_at,
       created_at, updated_at
     FROM manual_match_proposals
     WHERE organization_id = $1 AND id = $2
     FOR UPDATE`,
    [organizationId, proposalId],
  );
  const row = result.rows[0];
  return row ? mapProposalRow(row) : null;
}

export async function updateProposalDecision(
  client: PoolClient,
  input: {
    organizationId: string;
    proposalId: string;
    status: "approved" | "rejected" | "withdrawn";
    decidedByUserId: string;
    decidedByName: string;
    decisionReason: string | null;
  },
) {
  await client.query(
    `UPDATE manual_match_proposals
     SET status = $3,
       decided_by_user_id = CASE WHEN $3 IN ('approved','rejected') THEN $4 ELSE decided_by_user_id END,
       decided_by_name = CASE WHEN $3 IN ('approved','rejected') THEN $5 ELSE decided_by_name END,
       decision_reason = CASE WHEN $3 IN ('approved','rejected') THEN $6 ELSE decision_reason END,
       decided_at = CASE WHEN $3 IN ('approved','rejected') THEN NOW() ELSE decided_at END,
       updated_at = NOW()
     WHERE organization_id = $1 AND id = $2`,
    [
      input.organizationId,
      input.proposalId,
      input.status,
      input.decidedByUserId,
      input.decidedByName,
      input.decisionReason,
    ],
  );
}

export async function insertManualMatchEvent(
  client: PoolClient,
  input: {
    organizationId: string;
    proposalId: string;
    actorUserId: string | null;
    actorName: string;
    eventType: ManualMatchEventType;
    details: Record<string, unknown>;
  },
) {
  await client.query(
    `INSERT INTO manual_match_events (
       organization_id, proposal_id, actor_user_id, actor_name, event_type, details
     ) VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      input.organizationId,
      input.proposalId,
      input.actorUserId,
      input.actorName,
      input.eventType,
      JSON.stringify(input.details),
    ],
  );
}

export async function getProposalById(
  organizationId: string,
  proposalId: string,
  client?: PoolClient,
): Promise<ManualMatchProposal | null> {
  const execute = client ? client.query.bind(client) : query;
  const result = await execute<ProposalRow>(
    `SELECT id, item_id, run_id, proposal_type, status, reason,
       proposed_by_user_id, proposed_by_name,
       decided_by_user_id, decided_by_name, decision_reason, decided_at,
       created_at, updated_at
     FROM manual_match_proposals
     WHERE organization_id = $1 AND id = $2`,
    [organizationId, proposalId],
  );
  const row = result.rows[0];
  return row ? mapProposalRow(row) : null;
}

export async function listProposalEvents(
  organizationId: string,
  proposalId: string,
  client?: PoolClient,
): Promise<ManualMatchEvent[]> {
  const execute = client ? client.query.bind(client) : query;
  const result = await execute<{
    id: string;
    proposal_id: string;
    actor_user_id: string | null;
    actor_name: string;
    event_type: ManualMatchEventType;
    details: Record<string, unknown>;
    created_at: Date;
  }>(
    `SELECT id, proposal_id, actor_user_id, actor_name, event_type, details, created_at
     FROM manual_match_events
     WHERE organization_id = $1 AND proposal_id = $2
     ORDER BY created_at ASC`,
    [organizationId, proposalId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    proposalId: row.proposal_id,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    eventType: row.event_type,
    details: row.details,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function listProposalsForItem(
  organizationId: string,
  itemId: string,
  client?: PoolClient,
): Promise<ManualMatchProposal[]> {
  const execute = client ? client.query.bind(client) : query;
  const result = await execute<ProposalRow>(
    `SELECT id, item_id, run_id, proposal_type, status, reason,
       proposed_by_user_id, proposed_by_name,
       decided_by_user_id, decided_by_name, decision_reason, decided_at,
       created_at, updated_at
     FROM manual_match_proposals
     WHERE organization_id = $1 AND item_id = $2
     ORDER BY created_at DESC`,
    [organizationId, itemId],
  );
  return result.rows.map(mapProposalRow);
}

export async function hasPendingUnmatchForItem(
  client: PoolClient,
  organizationId: string,
  itemId: string,
) {
  const result = await client.query<{ exists: boolean }>(
    `SELECT TRUE AS exists
     FROM manual_match_proposals
     WHERE organization_id = $1
       AND item_id = $2
       AND proposal_type = 'manual_unmatch'
       AND status = 'proposed'
     LIMIT 1`,
    [organizationId, itemId],
  );
  return Boolean(result.rows[0]?.exists);
}

function mapProposalRow(row: ProposalRow): ManualMatchProposal {
  return {
    id: row.id,
    itemId: row.item_id,
    runId: row.run_id,
    proposalType: row.proposal_type,
    status: row.status,
    reason: row.reason,
    proposedByUserId: row.proposed_by_user_id,
    proposedByName: row.proposed_by_name,
    decidedByUserId: row.decided_by_user_id,
    decidedByName: row.decided_by_name,
    decisionReason: row.decision_reason,
    decidedAt: row.decided_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
