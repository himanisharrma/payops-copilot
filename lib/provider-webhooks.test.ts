import { describe, expect, it } from "vitest";
import {
  normalizeProviderWebhook,
  providerEventsForEntity,
  providerWebhookFixtures,
} from "./provider-webhooks";

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
