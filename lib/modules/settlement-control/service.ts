import type { Actor } from "@/lib/access";
import { transaction } from "@/lib/db";
import { recordAuditEvent } from "@/lib/modules/audit/repository";
import {
  lockSettlementRefresh,
  promoteOverdueSettlements,
} from "@/lib/modules/settlement-control/repository";
import { linkProgramCasesByIds } from "@/lib/modules/remediation-programs/repository";

export async function refreshSettlementControl(actor: Actor) {
  return transaction(async (client) => {
    await lockSettlementRefresh(client, actor.organizationId);
    const result = await promoteOverdueSettlements(
      client,
      actor.organizationId,
    );
    const linkedPrograms = await linkProgramCasesByIds(
      client,
      actor.organizationId,
      result.createdCaseIds,
    );

    await recordAuditEvent(
      {
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        actorName: actor.name,
        action: "settlement_control.refreshed",
        entityType: "organization",
        entityId: actor.organizationId,
        details: {
          scannedCount: result.scannedCount,
          createdCount: result.createdCount,
          createdCaseIds: result.createdCaseIds,
          linkedProgramCases: linkedPrograms.length,
        },
      },
      client,
    );

    return result;
  });
}
