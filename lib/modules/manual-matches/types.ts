export type ManualMatchProposalType = "manual_match" | "manual_unmatch";

export type ManualMatchProposalStatus =
  | "applied"
  | "proposed"
  | "approved"
  | "rejected"
  | "withdrawn";

export type ManualMatchEventType =
  | "manual_match_applied"
  | "manual_unmatch_proposed"
  | "manual_unmatch_approved"
  | "manual_unmatch_rejected"
  | "withdrawn";

export type ManualMatchProposal = {
  id: string;
  itemId: string;
  runId: string;
  proposalType: ManualMatchProposalType;
  status: ManualMatchProposalStatus;
  reason: string;
  proposedByUserId: string | null;
  proposedByName: string;
  decidedByUserId: string | null;
  decidedByName: string | null;
  decisionReason: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ManualMatchEvent = {
  id: string;
  proposalId: string;
  actorUserId: string | null;
  actorName: string;
  eventType: ManualMatchEventType;
  details: Record<string, unknown>;
  createdAt: string;
};

export type ManualMatchDecisionAction = "approve" | "reject" | "withdraw";
