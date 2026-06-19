import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { DomainError } from "@/lib/modules/errors";
import {
  ingestProviderEvent,
  resolveOrganizationBySlug,
} from "@/lib/modules/provider-events/repository";
import { normalizeProviderWebhook } from "@/lib/provider-webhooks";
import type { ProviderId } from "@/lib/types";

const providerIds = [
  "razorpay_demo",
  "cashfree_demo",
  "payu_demo",
] as const;

const webhookBodySchema = z.object({
  eventType: z.string().trim().min(1).max(120),
  occurredAt: z.iso.datetime({ offset: true }),
  payload: z.record(z.string(), z.unknown()),
});

export function syntheticWebhookSignature(input: {
  secret: string;
  organizationSlug: string;
  externalEventId: string;
  rawBody: string;
}) {
  return createHmac("sha256", input.secret)
    .update(
      `${input.organizationSlug}.${input.externalEventId}.${input.rawBody}`,
      "utf8",
    )
    .digest("hex");
}

export function verifySyntheticWebhookSignature(input: {
  secret: string;
  organizationSlug: string;
  externalEventId: string;
  rawBody: string;
  signature: string;
}) {
  const expected = Buffer.from(
    syntheticWebhookSignature(input),
    "utf8",
  );
  const received = Buffer.from(input.signature.toLowerCase(), "utf8");
  return (
    expected.length === received.length &&
    timingSafeEqual(expected, received)
  );
}

export async function receiveSyntheticProviderWebhook(input: {
  providerId: string;
  organizationSlug: string;
  externalEventId: string;
  signature: string;
  rawBody: string;
}) {
  if (!providerIds.includes(input.providerId as (typeof providerIds)[number])) {
    throw new DomainError("Unsupported synthetic provider.", 404);
  }
  if (!input.organizationSlug || !input.externalEventId || !input.signature) {
    throw new DomainError("Required webhook headers are missing.", 400);
  }
  const secret = process.env.SYNTHETIC_WEBHOOK_SECRET;
  if (!secret) {
    throw new DomainError("Synthetic webhook ingestion is not configured.", 503);
  }
  if (
    !verifySyntheticWebhookSignature({
      ...input,
      secret,
    })
  ) {
    throw new DomainError("Invalid webhook signature.", 401);
  }

  let body: unknown;
  try {
    body = JSON.parse(input.rawBody);
  } catch {
    throw new DomainError("Webhook body must be valid JSON.", 400);
  }
  const parsed = webhookBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new DomainError("Webhook body is invalid.", 400);
  }
  const organization = await resolveOrganizationBySlug(input.organizationSlug);
  if (!organization) {
    throw new DomainError("Organization not found.", 404);
  }
  const providerEvent = normalizeProviderWebhook({
    providerId: input.providerId as Exclude<ProviderId, "generic">,
    ...parsed.data,
  });
  const result = await ingestProviderEvent({
    organizationId: organization.id,
    externalEventId: input.externalEventId,
    externalEventType: parsed.data.eventType,
    payloadHash: createHash("sha256").update(input.rawBody).digest("hex"),
    providerEvent,
  });
  if (!result.samePayload) {
    throw new DomainError(
      "Webhook event ID was already used with a different payload.",
      409,
    );
  }
  return {
    ...result,
    providerEvent,
    organizationName: organization.name,
  };
}
