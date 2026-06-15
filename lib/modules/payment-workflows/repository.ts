import { query, transaction } from "@/lib/db";
import { terminalWorkflowStatuses } from "@/lib/payment-workflow";
import type {
  PaymentWorkflow,
  PaymentWorkflowStatus,
} from "@/lib/types";

export async function listPaymentWorkflows(
  organizationId: string,
): Promise<PaymentWorkflow[]> {
  const result = await query<{
    id: string;
    workflow_type: PaymentWorkflow["type"];
    external_reference: string;
    order_id: string;
    payment_reference: string;
    amount: string;
    reason: string;
    status: PaymentWorkflowStatus;
    priority: PaymentWorkflow["priority"];
    owner: string | null;
    due_at: Date;
    evidence_checklist: PaymentWorkflow["evidenceChecklist"];
    notes: string;
    resolved_at: Date | null;
    created_at: Date;
    updated_at: Date;
    events: Array<{
      id: string;
      eventType: string;
      title: string;
      detail: string;
      actorName: string;
      createdAt: string;
    }>;
  }>(
    `SELECT workflow.*,
       COALESCE(
         jsonb_agg(
           jsonb_build_object(
             'id', event.id,
             'eventType', event.event_type,
             'title', event.title,
             'detail', event.detail,
             'actorName', event.actor_name,
             'createdAt', event.created_at
           ) ORDER BY event.created_at DESC
         ) FILTER (WHERE event.id IS NOT NULL),
         '[]'::jsonb
       ) AS events
     FROM payment_workflows workflow
     LEFT JOIN payment_workflow_events event
       ON event.workflow_id = workflow.id
     WHERE workflow.organization_id = $1
     GROUP BY workflow.id
     ORDER BY
       CASE WHEN workflow.resolved_at IS NULL THEN 0 ELSE 1 END,
       workflow.due_at ASC,
       workflow.created_at DESC`,
    [organizationId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    type: row.workflow_type,
    externalReference: row.external_reference,
    orderId: row.order_id,
    paymentReference: row.payment_reference,
    amount: Number(row.amount),
    reason: row.reason,
    status: row.status,
    priority: row.priority,
    owner: row.owner,
    dueAt: row.due_at.toISOString(),
    evidenceChecklist: row.evidence_checklist,
    notes: row.notes,
    resolvedAt: row.resolved_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    events: row.events,
  }));
}

export async function updatePaymentWorkflow(
  id: string,
  organizationId: string,
  patch: {
    status?: PaymentWorkflowStatus;
    priority?: PaymentWorkflow["priority"];
    owner?: string | null;
    notes?: string;
    evidenceChecklist?: PaymentWorkflow["evidenceChecklist"];
  },
  actorName: string,
) {
  return transaction(async (client) => {
    const existing = await client.query<{
      status: PaymentWorkflowStatus;
      priority: PaymentWorkflow["priority"];
      owner: string | null;
      notes: string;
      evidence_checklist: PaymentWorkflow["evidenceChecklist"];
    }>(
      `SELECT status, priority, owner, notes, evidence_checklist
       FROM payment_workflows
       WHERE id = $1 AND organization_id = $2
       FOR UPDATE`,
      [id, organizationId],
    );
    if (!existing.rowCount) return null;

    const before = existing.rows[0];
    const status = patch.status ?? before.status;
    const terminal = terminalWorkflowStatuses.has(status);

    await client.query(
      `UPDATE payment_workflows SET
         status = COALESCE($3, status),
         priority = COALESCE($4, priority),
         owner = CASE WHEN $5::boolean THEN $6 ELSE owner END,
         notes = COALESCE($7, notes),
         evidence_checklist = COALESCE($8, evidence_checklist),
         resolved_at = CASE
           WHEN $9 THEN COALESCE(resolved_at, NOW())
           WHEN $3 IS NOT NULL THEN NULL
           ELSE resolved_at
         END,
         updated_at = NOW()
       WHERE id = $1 AND organization_id = $2`,
      [
        id,
        organizationId,
        patch.status ?? null,
        patch.priority ?? null,
        Object.prototype.hasOwnProperty.call(patch, "owner"),
        patch.owner ?? null,
        patch.notes ?? null,
        patch.evidenceChecklist
          ? JSON.stringify(patch.evidenceChecklist)
          : null,
        terminal,
      ],
    );

    const changes = [
      patch.status && patch.status !== before.status
        ? `Status changed from ${before.status} to ${patch.status}.`
        : "",
      patch.priority && patch.priority !== before.priority
        ? `Priority changed from ${before.priority} to ${patch.priority}.`
        : "",
      Object.prototype.hasOwnProperty.call(patch, "owner") &&
      patch.owner !== before.owner
        ? `Owner changed from ${before.owner ?? "unassigned"} to ${patch.owner ?? "unassigned"}.`
        : "",
      patch.evidenceChecklist ? "Evidence checklist updated." : "",
      typeof patch.notes === "string" && patch.notes !== before.notes
        ? "Operations notes updated."
        : "",
    ].filter(Boolean);

    if (changes.length) {
      await client.query(
        `INSERT INTO payment_workflow_events (
           workflow_id, event_type, title, detail, actor_name
         ) VALUES ($1,$2,$3,$4,$5)`,
        [
          id,
          patch.status ? "status_update" : "workflow_update",
          patch.status ? "Lifecycle stage updated" : "Workflow evidence updated",
          changes.join(" "),
          actorName,
        ],
      );
    }

    return id;
  });
}
