import { z } from "zod";

// Slice 5 has no API surface — schemas are reserved for the future
// refund-allocation operations panel. The refund candidate shape is
// produced by the engine, not the API, so its validation lives in the
// engine path, not here.

export const refundAllocationStatusSchema = z.enum(["applied", "superseded"]);

export type ValidatedRefundAllocationStatus = z.infer<
  typeof refundAllocationStatusSchema
>;
