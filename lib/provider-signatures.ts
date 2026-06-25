import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { ProviderId } from "@/lib/types";

type SignedProviderId = Exclude<ProviderId, "generic">;

export type WebhookKey = {
  id: string;
  secret: string;
};

export type WebhookKeyringEntry = {
  active: WebhookKey;
  previous?: WebhookKey;
};

export type WebhookKeyring = Record<SignedProviderId, WebhookKeyringEntry>;

const signedProviders: SignedProviderId[] = [
  "razorpay_demo",
  "cashfree_demo",
  "payu_demo",
];

export function parseWebhookKeyring(value?: string): WebhookKeyring | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<WebhookKeyring>;
    for (const providerId of signedProviders) {
      const entry = parsed[providerId];
      if (!validKey(entry?.active)) return null;
      if (entry?.previous && !validKey(entry.previous)) return null;
      if (
        entry?.previous &&
        entry.previous.id === entry.active.id
      ) {
        return null;
      }
    }
    return parsed as WebhookKeyring;
  } catch {
    return null;
  }
}

function validKey(value: unknown): value is WebhookKey {
  if (!value || typeof value !== "object") return false;
  const key = value as WebhookKey;
  return (
    typeof key.id === "string" &&
    /^[a-z0-9][a-z0-9._-]{1,63}$/i.test(key.id) &&
    typeof key.secret === "string" &&
    key.secret.length >= 24
  );
}

export function providerSignatureCanonical(input: {
  providerId: SignedProviderId;
  organizationSlug: string;
  externalEventId: string;
  rawBody: string;
  timestamp?: string;
}) {
  if (input.providerId === "razorpay_demo") {
    return input.rawBody;
  }
  if (input.providerId === "cashfree_demo") {
    if (!input.timestamp) return null;
    return `${input.timestamp}.${input.rawBody}`;
  }
  return [
    input.organizationSlug,
    input.externalEventId,
    createHash("sha256").update(input.rawBody).digest("hex"),
  ].join("|");
}

export function providerWebhookSignature(input: {
  providerId: SignedProviderId;
  secret: string;
  organizationSlug: string;
  externalEventId: string;
  rawBody: string;
  timestamp?: string;
}) {
  const canonical = providerSignatureCanonical(input);
  if (canonical === null) return null;
  return createHmac("sha256", input.secret)
    .update(canonical, "utf8")
    .digest("hex");
}

export function verifyProviderWebhookSignature(input: {
  providerId: SignedProviderId;
  keyId: string;
  signature: string;
  organizationSlug: string;
  externalEventId: string;
  rawBody: string;
  timestamp?: string;
  now?: Date;
  keyring: WebhookKeyring;
}) {
  const entry = input.keyring[input.providerId];
  const key =
    entry.active.id === input.keyId
      ? entry.active
      : entry.previous?.id === input.keyId
        ? entry.previous
        : null;
  if (!key) return { valid: false, reason: "unknown_key" as const };

  if (input.providerId === "cashfree_demo") {
    const timestamp = Number(input.timestamp);
    if (!Number.isFinite(timestamp)) {
      return { valid: false, reason: "missing_timestamp" as const };
    }
    const age = Math.abs(
      (input.now ?? new Date()).getTime() - timestamp * 1000,
    );
    if (age > 5 * 60 * 1000) {
      return { valid: false, reason: "stale_timestamp" as const };
    }
  }

  const expected = providerWebhookSignature({
    ...input,
    secret: key.secret,
  });
  if (!expected) {
    return { valid: false, reason: "missing_timestamp" as const };
  }
  const received = Buffer.from(input.signature.toLowerCase(), "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const valid =
    received.length === expectedBuffer.length &&
    timingSafeEqual(received, expectedBuffer);
  return {
    valid,
    reason: valid ? null : ("invalid_signature" as const),
    keyState:
      key.id === entry.active.id
        ? ("active" as const)
        : ("previous" as const),
  };
}
