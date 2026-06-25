import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { DomainError } from "@/lib/modules/errors";
import {
  ingestProviderEvent,
  recordProviderWebhookAttempt,
  resolveOrganizationBySlug,
} from "@/lib/modules/provider-events/repository";
import { normalizeProviderWebhook } from "@/lib/provider-webhooks";
import {
  parseWebhookKeyring,
  verifyProviderWebhookSignature,
} from "@/lib/provider-signatures";
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
  signatureVersion?: string;
  keyId?: string;
  timestamp?: string;
  rawBody: string;
}) {
  const startedAt = Date.now();
  const payloadHash = createHash("sha256")
    .update(input.rawBody)
    .digest("hex");
  let organization: { id: string; name: string } | null = null;
  let eventType: string | null = null;
  let keyState: "active" | "previous" | null = null;
  let verificationFailureCode: string | null = null;
  const signatureVersion = input.signatureVersion || "legacy-v1";
  const signatureKeyId =
    signatureVersion === "provider-v2" ? input.keyId ?? null : "legacy";

  try {
    if (
      !providerIds.includes(
        input.providerId as (typeof providerIds)[number],
      )
    ) {
      throw new DomainError("Unsupported synthetic provider.", 404);
    }
    if (!input.organizationSlug) {
      throw new DomainError("Required webhook headers are missing.", 400);
    }
    organization = await resolveOrganizationBySlug(input.organizationSlug);
    if (!organization) {
      throw new DomainError("Invalid webhook signature.", 401);
    }
    if (!input.externalEventId || !input.signature) {
      verificationFailureCode = "required_header_missing";
      throw new DomainError("Required webhook headers are missing.", 400);
    }
    if (signatureVersion === "provider-v2") {
      const keyring = parseWebhookKeyring(
        process.env.SYNTHETIC_WEBHOOK_KEYRING,
      );
      if (!keyring) {
        throw new DomainError(
          "Provider webhook keyring is not configured.",
          503,
        );
      }
      if (!input.keyId) {
        verificationFailureCode = "key_id_missing";
        throw new DomainError("Webhook key ID is required.", 400);
      }
      const verification = verifyProviderWebhookSignature({
        providerId: input.providerId as Exclude<ProviderId, "generic">,
        keyId: input.keyId,
        signature: input.signature,
        organizationSlug: input.organizationSlug,
        externalEventId: input.externalEventId,
        rawBody: input.rawBody,
        timestamp: input.timestamp,
        keyring,
      });
      if (!verification.valid) {
        verificationFailureCode = verification.reason;
        throw new DomainError(
          `Webhook signature rejected: ${verification.reason}.`,
          401,
        );
      }
      keyState = verification.keyState ?? null;
    } else if (signatureVersion === "legacy-v1") {
      const secret = process.env.SYNTHETIC_WEBHOOK_SECRET;
      if (!secret) {
        throw new DomainError(
          "Synthetic webhook ingestion is not configured.",
          503,
        );
      }
      if (
        !verifySyntheticWebhookSignature({
          ...input,
          secret,
        })
      ) {
        verificationFailureCode = "invalid_signature";
        throw new DomainError("Invalid webhook signature.", 401);
      }
    } else {
      verificationFailureCode = "unsupported_signature_version";
      throw new DomainError("Unsupported signature version.", 400);
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
    eventType = parsed.data.eventType;
    const providerEvent = normalizeProviderWebhook({
      providerId: input.providerId as Exclude<ProviderId, "generic">,
      ...parsed.data,
    });
    const result = await ingestProviderEvent({
      organizationId: organization.id,
      externalEventId: input.externalEventId,
      externalEventType: parsed.data.eventType,
      payloadHash,
      signatureVersion,
      signatureKeyId: signatureKeyId ?? "unknown",
      providerEvent,
    });
    if (!result.samePayload) {
      throw new DomainError(
        "Webhook event ID was already used with a different payload.",
        409,
      );
    }
    await recordProviderWebhookAttempt({
      organizationId: organization.id,
      providerId: providerEvent.providerId,
      externalEventId: input.externalEventId,
      eventType,
      payloadHash,
      signatureVersion,
      signatureKeyId,
      keyState,
      outcome: result.accepted ? "accepted" : "duplicate",
      httpStatus: result.accepted ? 202 : 200,
      matchedRecords: result.matches.length,
      providerEventId: result.providerEventId,
      processingMs: Date.now() - startedAt,
    });
    return {
      ...result,
      providerEvent,
      organizationName: organization.name,
    };
  } catch (error) {
    if (
      organization &&
      providerIds.includes(
        input.providerId as (typeof providerIds)[number],
      )
    ) {
      const status =
        error instanceof DomainError ? error.status : 503;
      const outcome =
        status === 409
          ? "conflict"
          : status >= 500
            ? "failed"
            : "rejected";
      try {
        await recordProviderWebhookAttempt({
          organizationId: organization.id,
          providerId: input.providerId as Exclude<ProviderId, "generic">,
          externalEventId: input.externalEventId || "missing",
          eventType,
          payloadHash,
          signatureVersion,
          signatureKeyId,
          keyState,
          outcome,
          httpStatus: status,
          failureCode:
            verificationFailureCode ?? webhookFailureCode(error),
          processingMs: Date.now() - startedAt,
        });
      } catch (attemptError) {
        console.error("Webhook attempt evidence could not be stored.", attemptError);
      }
    }
    throw error;
  }
}

function webhookFailureCode(error: unknown) {
  if (!(error instanceof Error)) return "unknown_failure";
  const message = error.message.toLowerCase();
  if (message.includes("signature")) return "signature_rejected";
  if (message.includes("key id")) return "key_id_missing";
  if (message.includes("keyring")) return "keyring_unavailable";
  if (message.includes("json")) return "invalid_json";
  if (message.includes("body")) return "invalid_body";
  if (message.includes("different payload")) return "event_id_conflict";
  if (message.includes("version")) return "unsupported_signature_version";
  return "processing_failure";
}
