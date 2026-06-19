import type { Actor } from "@/lib/access";
import { transaction } from "@/lib/db";
import { recordAuditEvent } from "@/lib/modules/audit/repository";
import { DomainError } from "@/lib/modules/errors";
import {
  listOperationalNotifications,
  markOperationalNotificationRead,
  refreshSlaNotifications,
} from "@/lib/modules/notifications/repository";

export async function getOperationalNotifications(actor: Actor) {
  if (actor.role !== "viewer") {
    await refreshSlaNotifications(actor.organizationId);
  }
  return listOperationalNotifications(actor.organizationId);
}

export async function readOperationalNotification(
  id: string,
  actor: Actor,
) {
  if (actor.role === "viewer") {
    throw new DomainError(
      "Viewers cannot change notification state.",
      403,
    );
  }
  return transaction(async (client) => {
    const notificationId = await markOperationalNotificationRead(client, {
      id,
      organizationId: actor.organizationId,
      userId: actor.id,
    });
    if (!notificationId) {
      throw new DomainError("Notification not found.", 404);
    }
    await recordAuditEvent(
      {
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        actorName: actor.name,
        action: "notification.read",
        entityType: "operational_notification",
        entityId: notificationId,
      },
      client,
    );
    return notificationId;
  });
}
