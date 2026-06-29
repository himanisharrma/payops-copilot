import { z } from "zod";

export const proposeManualMatchInput = z.object({
  reason: z.string().trim().min(10).max(2000),
  evidenceConfirmed: z.literal(true),
});

export const decideManualMatchInput = z.object({
  action: z.enum(["approve", "reject", "withdraw"]),
  decisionReason: z.string().trim().min(10).max(2000).optional(),
});

export type ProposeManualMatchInput = z.infer<typeof proposeManualMatchInput>;
export type DecideManualMatchInput = z.infer<typeof decideManualMatchInput>;
