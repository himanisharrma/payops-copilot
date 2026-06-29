import type { Actor } from "@/lib/access";
import { transaction } from "@/lib/db";
import { recordAuditEvent } from "@/lib/modules/audit/repository";
import { DomainError } from "@/lib/modules/errors";
import { postCaptureEntries } from "@/lib/modules/ledger/service";
import type { ProviderId } from "@/lib/modules/ledger/types";
import { ensureDefaultMerchantAccount } from "@/lib/modules/merchant-settlements/repository";
import { refreshPayoutSumChecks } from "@/lib/modules/reconciliation/reason-codes";
import { saveReconciliationRun } from "@/lib/modules/reconciliation/repository";
import { refreshRefundAllocations } from "@/lib/modules/refund-allocations/service";
import { providerIds } from "@/lib/provider-adapters";
import { reconcilePayments } from "@/lib/reconciliation";
import type {
  RawRecord,
  ReconciliationRequest,
} from "@/lib/types";

export function validateReconciliationRequest(
  input: unknown,
): asserts input is ReconciliationRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new DomainError("Reconciliation request must be an object.", 400);
  }

  const payload = input as Partial<ReconciliationRequest>;
  if (
    !isRecordArray(payload.orders) ||
    !isRecordArray(payload.gateway) ||
    !isRecordArray(payload.settlements)
  ) {
    throw new DomainError(
      "Orders, gateway, and settlement records are required.",
      400,
    );
  }
  if (
    payload.sourceType !== undefined &&
    payload.sourceType !== "demo" &&
    payload.sourceType !== "upload"
  ) {
    throw new DomainError("Source type must be demo or upload.", 400);
  }
  if (
    payload.providerId !== undefined &&
    !providerIds.includes(payload.providerId)
  ) {
    throw new DomainError("Unsupported provider adapter.", 400);
  }
  if (
    payload.runName !== undefined &&
    typeof payload.runName !== "string"
  ) {
    throw new DomainError("Run name must be text.", 400);
  }
  if (
    payload.sourceFiles !== undefined &&
    (!payload.sourceFiles ||
      typeof payload.sourceFiles !== "object" ||
      Array.isArray(payload.sourceFiles))
  ) {
    throw new DomainError("Source files metadata must be an object.", 400);
  }
}

export async function createReconciliationRun(
  input: unknown,
  actor: Actor,
) {
  validateReconciliationRequest(input);
  const result = reconcilePayments(input);
  return transaction(async (client) => {
    const stored = await saveReconciliationRun(client, result, {
      organizationId: actor.organizationId,
      name:
        input.runName?.trim() ||
        `Reconciliation ${new Date().toLocaleDateString("en-IN")}`,
      sourceType: input.sourceType ?? "upload",
      providerId: input.providerId ?? "generic",
      sourceFiles: input.sourceFiles ?? {},
    });

    // Slice 4: post-persist sum check across all items that share a payout_id.
    // Stamped items where the engine couldn't reach a settlement row (and thus
    // have a null payoutId) are excluded — they don't belong to any group.
    const payoutIds = Array.from(
      new Set(
        stored.items
          .map((item) => item.payoutId)
          .filter((value): value is string => Boolean(value)),
      ),
    );
    await refreshPayoutSumChecks(
      client,
      actor.organizationId,
      payoutIds,
      "reconciliation_run_persisted",
      { id: actor.id, name: actor.name },
    );

    // Slice 5: refund netting runs AFTER the payout sum check so that
    // payout_sum_mismatch (group-level) keeps precedence over the
    // refund_offset_recognized stamp this hook produces.
    await refreshRefundAllocations(
      client,
      actor.organizationId,
      stored.refundCandidates,
      "reconciliation_run_persisted",
      { id: actor.id, name: actor.name },
      stored.id,
    );

    // Slice 6b — Bridge 1: post capture entries to the ledger for every
    // matched / amount_mismatch item the engine wrote. Captures use
    // orderAmount (gross), not settledAmount — fees + GST are
    // recognized later via Bridge 2 (merchant-settlements). Items in
    // 'missing_settlement' / 'gateway_missing' / 'duplicate' /
    // 'pending' states represent un-settled (or un-known) captures, so
    // they do NOT post yet — they'd produce phantom provider_receivable
    // balance without a matched settlement to offset.
    const captureRows = await client.query<{
      id: string;
      order_id: string;
      gateway_reference: string;
      order_amount: string;
      transaction_at: Date | null;
    }>(
      `SELECT id, order_id, gateway_reference,
              order_amount::text AS order_amount, transaction_at
         FROM reconciliation_items
        WHERE organization_id = $1
          AND run_id = $2
          AND reconciliation_status IN ('matched', 'amount_mismatch')`,
      [actor.organizationId, stored.id],
    );
    if (captureRows.rowCount && captureRows.rowCount > 0) {
      const merchantAccountId = await ensureDefaultMerchantAccount(
        client,
        actor.organizationId,
      );
      const provider = (input.providerId ?? "generic") as ProviderId;
      await postCaptureEntries(
        client,
        actor.organizationId,
        captureRows.rows.map((row) => ({
          sourceItemId: row.id,
          merchantAccountId,
          provider,
          grossAmount: Number(row.order_amount),
          effectiveAt: row.transaction_at ?? new Date(),
          externalRefs: {
            orderId: row.order_id,
            gatewayReference: row.gateway_reference,
          },
        })),
        { id: actor.id, name: actor.name },
      );
    }

    await recordAuditEvent({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      actorName: actor.name,
      action: "reconciliation.created",
      entityType: "reconciliation_run",
      entityId: stored.id!,
      details: {
        totalOrders: stored.summary.totalOrders,
        exceptionCount: stored.summary.exceptionCount,
        providerId: input.providerId ?? "generic",
        providerIssueCount: stored.providerReport?.issues.length ?? 0,
        sourceEvidenceRows: stored.items.reduce(
          (total, item) => total + item.sourceEvidence.length,
          0,
        ),
      },
    }, client);

    return stored;
  });
}

function isRecordArray(value: unknown): value is RawRecord[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) => item !== null && typeof item === "object" && !Array.isArray(item),
    )
  );
}
