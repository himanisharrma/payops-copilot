import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import type { OperationalNotification } from "@/lib/types";

export async function refreshSlaNotifications(
  organizationId: string,
  client?: PoolClient,
) {
  const execute = client ? client.query.bind(client) : query;
  await execute(
    `INSERT INTO operational_notifications (
       organization_id, notification_type, severity, title, message,
       entity_type, entity_id, dedupe_key
     )
     SELECT
       c.organization_id,
       CASE WHEN NOW() > c.due_at THEN 'sla_overdue' ELSE 'sla_at_risk' END,
       CASE WHEN NOW() > c.due_at THEN 'critical' ELSE 'warning' END,
       CASE WHEN NOW() > c.due_at
         THEN 'Case SLA overdue'
         ELSE 'Case SLA at risk'
       END,
       CASE WHEN NOW() > c.due_at
         THEN 'The case passed its deterministic SLA deadline and needs human attention.'
         ELSE 'The case entered the final 25% of its deterministic SLA window.'
       END,
       'operations_case',
       c.id,
       'case:' || c.id::text || ':' ||
         CASE WHEN NOW() > c.due_at THEN 'overdue:' ELSE 'at-risk:' END ||
         c.due_at::text
     FROM operations_cases c
     WHERE c.organization_id = $1
       AND c.case_status <> 'resolved'
       AND (
         NOW() > c.due_at
         OR c.due_at - NOW() <=
           CASE c.priority
             WHEN 'high' THEN INTERVAL '1 hour'
             WHEN 'medium' THEN INTERVAL '6 hours'
             ELSE INTERVAL '18 hours'
           END
       )
     ON CONFLICT (organization_id, dedupe_key) DO NOTHING`,
    [organizationId],
  );
}

export async function listOperationalNotifications(
  organizationId: string,
  client?: PoolClient,
): Promise<OperationalNotification[]> {
  const execute = client ? client.query.bind(client) : query;
  const result = await execute<{
    id: string;
    notification_type: OperationalNotification["type"];
    severity: OperationalNotification["severity"];
    title: string;
    message: string;
    entity_type: OperationalNotification["entityType"];
    entity_id: string | null;
    read_at: Date | null;
    created_at: Date;
  }>(
    `SELECT id, notification_type, severity, title, message, entity_type,
       entity_id, read_at, created_at
     FROM operational_notifications
     WHERE organization_id = $1
     ORDER BY read_at NULLS FIRST, created_at DESC
     LIMIT 30`,
    [organizationId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    type: row.notification_type,
    severity: row.severity,
    title: row.title,
    message: row.message,
    entityType: row.entity_type,
    entityId: row.entity_id,
    readAt: row.read_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function markOperationalNotificationRead(
  client: PoolClient,
  input: {
    id: string;
    organizationId: string;
    userId: string;
  },
) {
  const result = await client.query<{ id: string }>(
    `UPDATE operational_notifications
     SET read_at = COALESCE(read_at, NOW()),
         read_by_user_id = COALESCE(read_by_user_id, $3)
     WHERE id = $1 AND organization_id = $2
     RETURNING id`,
    [input.id, input.organizationId, input.userId],
  );
  return result.rows[0]?.id ?? null;
}
