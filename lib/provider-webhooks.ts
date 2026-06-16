import type {
  NormalizedProviderEvent,
  ProviderId,
  ProviderWebhookPayload,
} from "@/lib/types";

export const providerWebhookFixtures: ProviderWebhookPayload[] = [
  {
    providerId: "razorpay_demo",
    eventType: "payment.captured",
    occurredAt: "2026-06-01T04:00:00.000Z",
    payload: {
      payment: {
        id: "PAY-90101",
        order_id: "ORD-260601",
        amount: 1249900,
        status: "captured",
        method: "upi",
      },
    },
  },
  {
    providerId: "razorpay_demo",
    eventType: "settlement.processed",
    occurredAt: "2026-06-02T05:35:00.000Z",
    payload: {
      settlement: {
        id: "SETL-RZP-260601",
        payment_id: "PAY-90101",
        order_id: "ORD-260601",
        amount: 1235151,
        utr: "UTR260601001",
      },
    },
  },
  {
    providerId: "cashfree_demo",
    eventType: "PAYMENT_SUCCESS_WEBHOOK",
    occurredAt: "2026-06-01T07:05:00.000Z",
    payload: {
      data: {
        order: { order_id: "ORD-260607", order_amount: 8999 },
        payment: {
          cf_payment_id: "PAY-90107",
          payment_status: "SUCCESS",
          payment_group: "upi",
        },
      },
    },
  },
  {
    providerId: "cashfree_demo",
    eventType: "PAYMENT_SUCCESS_WEBHOOK",
    occurredAt: "2026-06-01T07:06:00.000Z",
    payload: {
      data: {
        order: { order_id: "ORD-260607", order_amount: 8999 },
        payment: {
          cf_payment_id: "PAY-90107-DUP",
          payment_status: "SUCCESS",
          payment_group: "upi",
        },
      },
    },
  },
  {
    providerId: "payu_demo",
    eventType: "settlement.processed",
    occurredAt: "2026-06-03T05:55:00.000Z",
    payload: {
      mihpayid: "PAY-90109",
      txnid: "ORD-260609",
      net_amount: 6148.96,
      bank_ref_num: "UTR260601009",
      status: "settled",
    },
  },
  {
    providerId: "razorpay_demo",
    eventType: "refund.created",
    occurredAt: "2026-06-14T06:15:00.000Z",
    payload: {
      refund: {
        id: "RF-2026-1042",
        payment_id: "PAY-UPI-1042",
        order_id: "ORD-1042",
        amount: 249900,
        status: "processed",
      },
    },
  },
  {
    providerId: "razorpay_demo",
    eventType: "refund.processed",
    occurredAt: "2026-06-14T09:45:00.000Z",
    payload: {
      refund: {
        id: "RF-2026-1018",
        payment_id: "PAY-NB-1018",
        order_id: "ORD-1018",
        amount: 129900,
        status: "processed",
      },
    },
  },
  {
    providerId: "payu_demo",
    eventType: "chargeback.created",
    occurredAt: "2026-06-15T03:20:00.000Z",
    payload: {
      dispute_id: "CB-2026-0088",
      txnid: "ORD-0988",
      mihpayid: "PAY-CARD-0988",
      amount: 12450,
      reason: "Cardholder claims transaction not recognized",
      status: "evidence_due",
    },
  },
  {
    providerId: "payu_demo",
    eventType: "chargeback.evidence_due",
    occurredAt: "2026-06-15T04:10:00.000Z",
    payload: {
      dispute_id: "CB-2026-0088",
      due_by: "2026-06-16T12:00:00.000Z",
      required_documents: ["invoice", "delivery_proof", "authentication"],
    },
  },
  {
    providerId: "cashfree_demo",
    eventType: "REFUND_STATUS_WEBHOOK",
    occurredAt: "2026-06-14T11:30:00.000Z",
    payload: {
      data: {
        refund: {
          refund_id: "RF-2026-1037",
          cf_payment_id: "PAY-CARD-1037",
          order_id: "ORD-1037",
          refund_status: "PENDING",
        },
      },
    },
  },
];

export function normalizeProviderWebhook(
  webhook: ProviderWebhookPayload,
): NormalizedProviderEvent {
  if (webhook.providerId === "razorpay_demo") {
    return normalizeRazorpayWebhook(webhook);
  }
  if (webhook.providerId === "cashfree_demo") {
    return normalizeCashfreeWebhook(webhook);
  }
  return normalizePayuWebhook(webhook);
}

export function providerEventsForEntity(entity: {
  orderId: string;
  paymentReference?: string;
  externalReference?: string;
}) {
  return providerWebhookFixtures
    .map(normalizeProviderWebhook)
    .filter(
      (event) =>
        event.orderId === entity.orderId ||
        event.paymentReference === entity.paymentReference ||
        event.externalReference === entity.externalReference,
    )
    .sort(
      (left, right) =>
        new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime(),
    );
}

function normalizeRazorpayWebhook(
  webhook: ProviderWebhookPayload,
): NormalizedProviderEvent {
  const payload = webhook.payload as {
    payment?: {
      id?: string;
      order_id?: string;
      amount?: number;
      status?: string;
      method?: string;
    };
    settlement?: {
      id?: string;
      payment_id?: string;
      order_id?: string;
      amount?: number;
      utr?: string;
    };
    refund?: {
      id?: string;
      payment_id?: string;
      order_id?: string;
      amount?: number;
      status?: string;
    };
  };
  if (payload.payment) {
    return event({
      webhook,
      eventType: "payment_captured",
      orderId: payload.payment.order_id,
      paymentReference: payload.payment.id,
      amount: paiseToRupees(payload.payment.amount),
      status: payload.payment.status,
      title: "Payment captured",
      proves: "Provider observed a captured payment event for this order.",
      doesNotProve: "It does not prove the bank settlement has arrived.",
    });
  }
  if (payload.settlement) {
    return event({
      webhook,
      eventType: "settlement_processed",
      orderId: payload.settlement.order_id,
      paymentReference: payload.settlement.payment_id,
      amount: paiseToRupees(payload.settlement.amount),
      status: "settled",
      title: "Settlement processed",
      proves: "Provider settlement advice references this payment and UTR.",
      doesNotProve: "It does not prove the merchant ledger posted it correctly.",
    });
  }
  return event({
    webhook,
    eventType: webhook.eventType === "refund.processed" ? "refund_completed" : "refund_initiated",
    orderId: payload.refund?.order_id,
    paymentReference: payload.refund?.payment_id,
    externalReference: payload.refund?.id,
    amount: paiseToRupees(payload.refund?.amount),
    status: payload.refund?.status,
    title:
      webhook.eventType === "refund.processed"
        ? "Refund completed"
        : "Refund initiated",
    proves: "Provider refund event references the payment and refund ID.",
    doesNotProve: "It does not prove the customer's bank has credited funds.",
  });
}

function normalizeCashfreeWebhook(
  webhook: ProviderWebhookPayload,
): NormalizedProviderEvent {
  const payload = webhook.payload as {
    data?: {
      order?: { order_id?: string; order_amount?: number };
      payment?: {
        cf_payment_id?: string;
        payment_status?: string;
        payment_group?: string;
      };
      refund?: {
        refund_id?: string;
        cf_payment_id?: string;
        order_id?: string;
        refund_status?: string;
      };
    };
  };
  if (payload.data?.refund) {
    return event({
      webhook,
      eventType:
        payload.data.refund.refund_status === "SUCCESS"
          ? "refund_completed"
          : "refund_initiated",
      orderId: payload.data.refund.order_id,
      paymentReference: payload.data.refund.cf_payment_id,
      externalReference: payload.data.refund.refund_id,
      status: payload.data.refund.refund_status,
      title: "Refund status update",
      proves: "Provider sent a refund status update for this payment.",
      doesNotProve: "It does not prove the operation should be closed without ledger checks.",
    });
  }
  return event({
    webhook,
    eventType: "payment_captured",
    orderId: payload.data?.order?.order_id,
    paymentReference: payload.data?.payment?.cf_payment_id,
    amount: payload.data?.order?.order_amount ?? null,
    status: payload.data?.payment?.payment_status,
    title: "Payment success webhook",
    proves: "Provider sent a successful payment event for this order.",
    doesNotProve: "It does not prove this is not a duplicate provider event.",
  });
}

function normalizePayuWebhook(
  webhook: ProviderWebhookPayload,
): NormalizedProviderEvent {
  const payload = webhook.payload as {
    mihpayid?: string;
    txnid?: string;
    net_amount?: number;
    bank_ref_num?: string;
    status?: string;
    dispute_id?: string;
    amount?: number;
    reason?: string;
    due_by?: string;
  };
  if (webhook.eventType.startsWith("chargeback")) {
    return event({
      webhook,
      eventType:
        webhook.eventType === "chargeback.evidence_due"
          ? "chargeback_evidence_due"
          : "chargeback_received",
      orderId: payload.txnid,
      paymentReference: payload.mihpayid,
      externalReference: payload.dispute_id,
      amount: payload.amount ?? null,
      status: payload.status,
      title:
        webhook.eventType === "chargeback.evidence_due"
          ? "Chargeback evidence due"
          : "Chargeback received",
      proves: "Provider dispute event references this chargeback workflow.",
      doesNotProve: "It does not prove the dispute outcome or required response quality.",
    });
  }
  return event({
    webhook,
    eventType: "settlement_processed",
    orderId: payload.txnid,
    paymentReference: payload.mihpayid,
    amount: payload.net_amount ?? null,
    status: payload.status,
    title: "Settlement processed",
    proves: "Provider settlement advice references this payment.",
    doesNotProve: "It does not prove the bank statement row was uploaded.",
  });
}

function event(input: {
  webhook: ProviderWebhookPayload;
  eventType: NormalizedProviderEvent["eventType"];
  orderId?: string;
  paymentReference?: string;
  externalReference?: string;
  amount?: number | null;
  status?: string;
  title: string;
  proves: string;
  doesNotProve: string;
}): NormalizedProviderEvent {
  return {
    id: `${input.webhook.providerId}:${input.webhook.eventType}:${input.orderId ?? input.paymentReference ?? input.externalReference ?? input.webhook.occurredAt}`,
    providerId: input.webhook.providerId,
    eventType: input.eventType,
    title: input.title,
    orderId: input.orderId ?? null,
    paymentReference: input.paymentReference ?? null,
    externalReference: input.externalReference ?? null,
    amount: input.amount ?? null,
    status: input.status ?? null,
    occurredAt: input.webhook.occurredAt,
    proves: input.proves,
    doesNotProve: input.doesNotProve,
  };
}

function paiseToRupees(value?: number) {
  return typeof value === "number" ? value / 100 : null;
}

export function providerName(providerId: ProviderId) {
  return {
    generic: "Generic CSV",
    razorpay_demo: "Razorpay-style demo",
    cashfree_demo: "Cashfree-style demo",
    payu_demo: "PayU-style demo",
  }[providerId];
}
