import type { Actor } from "@/lib/access";
import { transaction } from "@/lib/db";
import { recordAuditEvent } from "@/lib/modules/audit/repository";
import { DomainError } from "@/lib/modules/errors";
import {
  getProposalById,
  getProposalForUpdate,
  getReconciliationItemForOverride,
  insertManualMatchEvent,
  insertManualMatchProposal,
  listProposalEvents,
  listProposalsForItem,
  updateProposalDecision,
} from "@/lib/modules/manual-matches/repository";
import type {
  ManualMatchDecisionAction,
  ManualMatchEvent,
  ManualMatchProposal,
} from "@/lib/modules/manual-matches/types";

type ProposeInput = {
  actor: Actor;
  itemId: string;
  reason: string;
  evidenceConfirmed: true;
};

type ProposeResult = {
  proposal: ManualMatchProposal;
  events: ManualMatchEvent[];
};

export async function proposeManualMatch(input: ProposeInput): Promise<ProposeResult> {
  validateActor(input.actor, ["analyst", "admin"]);
  const reason = normalizeReason(input.reason);
  return transaction(async (client) => {
    const item = await getReconciliationItemForOverride(
      client,
      input.actor.organizationId,
      input.itemId,
    );
    if (!item) throw new DomainError("Reconciliation item not found.", 404);
    if (item.reconciliationStatus === "matched") {
      throw new DomainError(
        "The engine already matched this item; no manual match required.",
        409,
      );
    }
    const proposalId = await insertWithUniqueGuard(() =>
      insertManualMatchProposal(client, {
        organizationId: input.actor.organizationId,
        itemId: item.itemId,
        runId: item.runId,
        proposalType: "manual_match",
        status: "applied",
        reason,
        proposedByUserId: input.actor.id,
        proposedByName: input.actor.name,
      }),
    );
    const details = {
      itemId: item.itemId,
      runId: item.runId,
      engineMatchStrategy: item.matchStrategy,
      engineMatchConfidence: item.matchConfidence,
      engineReasonCode: item.reasonCode,
      engineReconciliationStatus: item.reconciliationStatus,
    };
    await insertManualMatchEvent(client, {
      organizationId: input.actor.organizationId,
      proposalId,
      actorUserId: input.actor.id,
      actorName: input.actor.name,
      eventType: "manual_match_applied",
      details,
    });
    await recordAuditEvent(
      {
        organizationId: input.actor.organizationId,
        actorUserId: input.actor.id,
        actorName: input.actor.name,
        action: "manual_match.applied",
        entityType: "manual_match_proposal",
        entityId: proposalId,
        details,
      },
      client,
    );
    return loadProposal(input.actor.organizationId, proposalId, client);
  });
}

export async function proposeManualUnmatch(input: ProposeInput): Promise<ProposeResult> {
  validateActor(input.actor, ["analyst", "admin"]);
  const reason = normalizeReason(input.reason);
  return transaction(async (client) => {
    const item = await getReconciliationItemForOverride(
      client,
      input.actor.organizationId,
      input.itemId,
    );
    if (!item) throw new DomainError("Reconciliation item not found.", 404);
    if (item.reconciliationStatus !== "matched") {
      throw new DomainError(
        "Only items the engine marked matched can be manually unmatched.",
        409,
      );
    }
    const proposalId = await insertWithUniqueGuard(() =>
      insertManualMatchProposal(client, {
        organizationId: input.actor.organizationId,
        itemId: item.itemId,
        runId: item.runId,
        proposalType: "manual_unmatch",
        status: "proposed",
        reason,
        proposedByUserId: input.actor.id,
        proposedByName: input.actor.name,
      }),
    );
    const details = {
      itemId: item.itemId,
      runId: item.runId,
      engineMatchStrategy: item.matchStrategy,
      engineMatchConfidence: item.matchConfidence,
      engineReasonCode: item.reasonCode,
      engineReconciliationStatus: item.reconciliationStatus,
    };
    await insertManualMatchEvent(client, {
      organizationId: input.actor.organizationId,
      proposalId,
      actorUserId: input.actor.id,
      actorName: input.actor.name,
      eventType: "manual_unmatch_proposed",
      details,
    });
    await recordAuditEvent(
      {
        organizationId: input.actor.organizationId,
        actorUserId: input.actor.id,
        actorName: input.actor.name,
        action: "manual_match.proposed_unmatch",
        entityType: "manual_match_proposal",
        entityId: proposalId,
        details,
      },
      client,
    );
    return loadProposal(input.actor.organizationId, proposalId, client);
  });
}

export async function decideManualUnmatch(input: {
  actor: Actor;
  proposalId: string;
  action: ManualMatchDecisionAction;
  decisionReason?: string;
}): Promise<ProposeResult> {
  return transaction(async (client) => {
    const proposal = await getProposalForUpdate(
      client,
      input.actor.organizationId,
      input.proposalId,
    );
    if (!proposal) throw new DomainError("Manual override proposal not found.", 404);
    if (proposal.proposalType !== "manual_unmatch") {
      throw new DomainError("Manual match overrides cannot be decided.", 409);
    }
    if (proposal.status !== "proposed") {
      throw new DomainError("Only proposed unmatch overrides can be decided.", 409);
    }

    if (input.action === "approve" || input.action === "reject") {
      if (input.actor.role !== "admin") {
        throw new DomainError(
          "Only administrators can decide manual unmatch proposals.",
          403,
        );
      }
      if (
        input.action === "approve"
        && proposal.proposedByUserId === input.actor.id
      ) {
        throw new DomainError(
          "A different administrator must approve this manual unmatch.",
          403,
        );
      }
    } else if (input.action === "withdraw") {
      const isProposer = proposal.proposedByUserId === input.actor.id;
      if (!isProposer && input.actor.role !== "admin") {
        throw new DomainError(
          "Only the original proposer or an administrator can withdraw.",
          403,
        );
      }
    } else {
      throw new DomainError("Unsupported decision action.", 400);
    }

    let decisionReason: string | null = null;
    if (input.action === "approve" || input.action === "reject") {
      decisionReason = normalizeReason(input.decisionReason ?? "");
    }

    const status =
      input.action === "approve"
        ? "approved"
        : input.action === "reject"
          ? "rejected"
          : "withdrawn";
    await updateProposalDecision(client, {
      organizationId: input.actor.organizationId,
      proposalId: input.proposalId,
      status,
      decidedByUserId: input.actor.id,
      decidedByName: input.actor.name,
      decisionReason,
    });

    const eventType =
      status === "approved"
        ? "manual_unmatch_approved"
        : status === "rejected"
          ? "manual_unmatch_rejected"
          : "withdrawn";
    const details = {
      itemId: proposal.itemId,
      runId: proposal.runId,
      decisionReason,
      previousStatus: proposal.status,
    } as const;
    await insertManualMatchEvent(client, {
      organizationId: input.actor.organizationId,
      proposalId: input.proposalId,
      actorUserId: input.actor.id,
      actorName: input.actor.name,
      eventType,
      details,
    });
    await recordAuditEvent(
      {
        organizationId: input.actor.organizationId,
        actorUserId: input.actor.id,
        actorName: input.actor.name,
        action: `manual_match.${status}`,
        entityType: "manual_match_proposal",
        entityId: input.proposalId,
        details,
      },
      client,
    );

    return loadProposal(input.actor.organizationId, input.proposalId, client);
  });
}

export async function getManualMatchForItem(
  actor: Actor,
  itemId: string,
): Promise<{ proposals: ManualMatchProposal[]; events: ManualMatchEvent[] }> {
  const proposals = await listProposalsForItem(actor.organizationId, itemId);
  const events = await Promise.all(
    proposals.map((proposal) =>
      listProposalEvents(actor.organizationId, proposal.id),
    ),
  );
  return { proposals, events: events.flat() };
}

function normalizeReason(value: string) {
  const trimmed = value.trim();
  if (trimmed.length < 10) {
    throw new DomainError("Reason must be at least 10 characters.", 400);
  }
  if (trimmed.length > 2000) {
    throw new DomainError("Reason must be 2,000 characters or fewer.", 400);
  }
  return trimmed;
}

function validateActor(actor: Actor, allowed: Actor["role"][]) {
  if (!allowed.includes(actor.role)) {
    throw new DomainError("You do not have permission to propose overrides.", 403);
  }
}

async function loadProposal(
  organizationId: string,
  proposalId: string,
  client: import("pg").PoolClient,
): Promise<ProposeResult> {
  const proposal = await getProposalById(organizationId, proposalId, client);
  if (!proposal) {
    throw new DomainError("Manual override proposal vanished after write.", 503);
  }
  const events = await listProposalEvents(organizationId, proposalId, client);
  return { proposal, events };
}

async function insertWithUniqueGuard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DomainError(
        "An active manual override already exists for this item. Withdraw or resolve it first.",
        409,
      );
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: string }).code === "23505"
  );
}
