import { z } from "zod";

// Zod schemas for the Slice 6a API route inputs. Slice 6b adds the
// reverse-body schema; keeping it here so all ledger API contracts live
// in one file.

export const balanceQuerySchema = z.object({
  merchantAccountId: z.string().uuid(),
  asOf: z.string().datetime().optional(),
});

export const transactionsQuerySchema = z.object({
  merchantAccountId: z.string().uuid(),
  from: z.string().datetime(),
  to: z.string().datetime(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const reverseBodySchema = z.object({
  reason: z
    .string()
    .min(8, "Provide a reversal reason of at least 8 characters."),
});

export type BalanceQuery = z.infer<typeof balanceQuerySchema>;
export type TransactionsQuery = z.infer<typeof transactionsQuerySchema>;
export type ReverseBody = z.infer<typeof reverseBodySchema>;
