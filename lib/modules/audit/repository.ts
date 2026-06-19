import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import type { AuditEvent } from "@/lib/types";

export async function recordAuditEvent(input: {
  organizationId: string;
  actorUserId: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  details?: Record<string, unknown>;
}, client?: PoolClient) {
  const execute = client ? client.query.bind(client) : query;
  await execute(
    `INSERT INTO audit_events (
      organization_id, actor_user_id, actor_name, action,
      entity_type, entity_id, details
    ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      input.organizationId,
      input.actorUserId,
      input.actorName,
      input.action,
      input.entityType,
      input.entityId,
      JSON.stringify(input.details ?? {}),
    ],
  );
}

export async function listAuditEvents(
  organizationId: string,
): Promise<AuditEvent[]> {
  const result = await query<{
    id: string;
    actor_name: string;
    action: string;
    entity_type: string;
    entity_id: string;
    details: Record<string, unknown>;
    created_at: Date;
  }>(
    `SELECT id, actor_name, action, entity_type, entity_id, details, created_at
     FROM audit_events WHERE organization_id = $1
     ORDER BY created_at DESC LIMIT 100`,
    [organizationId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    actorName: row.actor_name,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    details: row.details,
    createdAt: row.created_at.toISOString(),
  }));
}
