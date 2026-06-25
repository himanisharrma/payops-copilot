import { describe, expect, it } from "vitest";
import {
  parseWebhookKeyring,
  providerWebhookSignature,
  verifyProviderWebhookSignature,
} from "./provider-signatures";

const keyring = {
  razorpay_demo: {
    active: { id: "rzp-2026-02", secret: "r".repeat(32) },
    previous: { id: "rzp-2026-01", secret: "p".repeat(32) },
  },
  cashfree_demo: {
    active: { id: "cf-2026-02", secret: "c".repeat(32) },
  },
  payu_demo: {
    active: { id: "payu-2026-02", secret: "u".repeat(32) },
  },
} as const;

describe("provider-specific synthetic signatures", () => {
  it("parses active and previous environment keys", () => {
    expect(parseWebhookKeyring(JSON.stringify(keyring))).toEqual(keyring);
    expect(parseWebhookKeyring("{}")).toBeNull();
  });

  it("uses distinct canonical contracts for each provider", () => {
    const base = {
      organizationSlug: "payops-portfolio",
      externalEventId: "evt-1",
      rawBody: '{"eventType":"payment.captured"}',
    };
    const timestamp = "1782100000";
    expect(
      providerWebhookSignature({
        ...base,
        providerId: "razorpay_demo",
        secret: keyring.razorpay_demo.active.secret,
      }),
    ).not.toBe(
      providerWebhookSignature({
        ...base,
        providerId: "payu_demo",
        secret: keyring.payu_demo.active.secret,
      }),
    );
    expect(
      providerWebhookSignature({
        ...base,
        providerId: "cashfree_demo",
        timestamp,
        secret: keyring.cashfree_demo.active.secret,
      }),
    ).toBeTruthy();
  });

  it("accepts the previous rotation key and rejects unknown keys", () => {
    const input = {
      providerId: "razorpay_demo" as const,
      organizationSlug: "payops-portfolio",
      externalEventId: "evt-1",
      rawBody: "{}",
    };
    const signature = providerWebhookSignature({
      ...input,
      secret: keyring.razorpay_demo.previous.secret,
    })!;
    expect(
      verifyProviderWebhookSignature({
        ...input,
        keyId: keyring.razorpay_demo.previous.id,
        signature,
        keyring: keyring as never,
      }),
    ).toMatchObject({ valid: true, keyState: "previous" });
    expect(
      verifyProviderWebhookSignature({
        ...input,
        keyId: "missing",
        signature,
        keyring: keyring as never,
      }),
    ).toMatchObject({ valid: false, reason: "unknown_key" });
  });

  it("rejects stale Cashfree-style timestamps", () => {
    const timestamp = String(
      Math.floor(new Date("2026-06-22T10:00:00Z").getTime() / 1000),
    );
    const input = {
      providerId: "cashfree_demo" as const,
      organizationSlug: "payops-portfolio",
      externalEventId: "evt-1",
      rawBody: "{}",
      timestamp,
    };
    const signature = providerWebhookSignature({
      ...input,
      secret: keyring.cashfree_demo.active.secret,
    })!;
    expect(
      verifyProviderWebhookSignature({
        ...input,
        keyId: keyring.cashfree_demo.active.id,
        signature,
        keyring: keyring as never,
        now: new Date("2026-06-22T10:06:00Z"),
      }),
    ).toMatchObject({ valid: false, reason: "stale_timestamp" });
  });
});
