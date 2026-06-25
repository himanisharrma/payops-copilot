import { describe, expect, it } from "vitest";
import {
  mergeProviderEvents,
  normalizeProviderWebhook,
  providerEventsForEntity,
  providerWebhookFixtures,
} from "./provider-webhooks";
import {
  syntheticWebhookSignature,
  verifySyntheticWebhookSignature,
} from "./modules/provider-events/service";

describe("provider webhook normalizer", () => {
  it("normalizes Razorpay-style captured payments", () => {
    const event = normalizeProviderWebhook(providerWebhookFixtures[0]);

    expect(event).toMatchObject({
      providerId: "razorpay_demo",
      eventType: "payment_captured",
      orderId: "ORD-260601",
      paymentReference: "PAY-90101",
      amount: 12499,
    });
    expect(event.proves).toContain("captured payment");
    expect(event.doesNotProve).toContain("bank settlement");
  });

  it("deduplicates persisted copies when timelines are merged", () => {
    const fixture = normalizeProviderWebhook(providerWebhookFixtures[0]);
    const persisted = { ...fixture, id: "persisted-event-id" };
    expect(mergeProviderEvents([fixture], [persisted])).toEqual([persisted]);
  });

  it("signs the tenant, event ID, and exact body", () => {
    const input = {
      secret: "test-secret",
      organizationSlug: "payops-portfolio",
      externalEventId: "evt-100",
      rawBody: '{"eventType":"payment.captured"}',
    };
    const signature = syntheticWebhookSignature(input);
    expect(
      verifySyntheticWebhookSignature({ ...input, signature }),
    ).toBe(true);
    expect(
      verifySyntheticWebhookSignature({
        ...input,
        externalEventId: "evt-replayed",
        signature,
      }),
    ).toBe(false);
    expect(
      verifySyntheticWebhookSignature({
        ...input,
        rawBody: '{"eventType":"payment.failed"}',
        signature,
      }),
    ).toBe(false);
  });

  it("normalizes Cashfree-style duplicate payment events into the same contract", () => {
    const events = providerEventsForEntity({ orderId: "ORD-260607" });

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.paymentReference)).toEqual([
      "PAY-90107",
      "PAY-90107-DUP",
    ]);
    expect(events.every((event) => event.eventType === "payment_captured")).toBe(
      true,
    );
  });

  it("finds synthetic refund and chargeback workflow events by external reference", () => {
    expect(
      providerEventsForEntity({
        orderId: "ORD-1018",
        externalReference: "RF-2026-1018",
      })[0],
    ).toMatchObject({
      eventType: "refund_completed",
      externalReference: "RF-2026-1018",
    });

    expect(
      providerEventsForEntity({
        orderId: "ORD-0988",
        externalReference: "CB-2026-0088",
      }).map((event) => event.eventType),
    ).toEqual(["chargeback_received", "chargeback_evidence_due"]);
  });
});
