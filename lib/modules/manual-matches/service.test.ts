import { describe, expect, it } from "vitest";
import {
  decideManualMatchInput,
  proposeManualMatchInput,
} from "@/lib/modules/manual-matches/schema";

describe("manual-match input schemas", () => {
  it("requires a reason of at least 10 trimmed characters and evidenceConfirmed: true", () => {
    expect(() =>
      proposeManualMatchInput.parse({
        reason: "too short",
        evidenceConfirmed: true,
      }),
    ).toThrow();
    expect(() =>
      proposeManualMatchInput.parse({
        reason: "this is a fine ten char reason",
        evidenceConfirmed: false,
      }),
    ).toThrow();
    expect(
      proposeManualMatchInput.parse({
        reason: "  the UTR ties out against bank credit BNK-501  ",
        evidenceConfirmed: true,
      }),
    ).toMatchObject({
      reason: "the UTR ties out against bank credit BNK-501",
      evidenceConfirmed: true,
    });
  });

  it("rejects reasons longer than 2000 characters", () => {
    expect(() =>
      proposeManualMatchInput.parse({
        reason: "x".repeat(2001),
        evidenceConfirmed: true,
      }),
    ).toThrow();
  });

  it("accepts approve/reject/withdraw decisions; withdraw may omit decisionReason", () => {
    expect(
      decideManualMatchInput.parse({
        action: "approve",
        decisionReason: "different admin confirmed evidence",
      }),
    ).toMatchObject({ action: "approve" });
    expect(decideManualMatchInput.parse({ action: "withdraw" })).toEqual({
      action: "withdraw",
    });
    expect(() => decideManualMatchInput.parse({ action: "promote" })).toThrow();
  });

  it("rejects decision reasons shorter than 10 characters when supplied", () => {
    expect(() =>
      decideManualMatchInput.parse({ action: "approve", decisionReason: "ok" }),
    ).toThrow();
  });
});
