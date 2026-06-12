import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type {
  InvestigationAnalysis,
  OperationsCase,
} from "@/lib/types";

const InvestigationSchema = z.object({
  likelyCause: z.string(),
  confidence: z.enum(["low", "medium", "high"]),
  supportingEvidence: z.array(z.string()),
  recommendedActions: z.array(z.string()),
  providerMessage: z.string(),
  limitations: z.array(z.string()),
});

const instructions = `You are a payment-operations investigation assistant.
Analyze only the supplied case facts. Do not invent transaction events, policies,
provider responses, or money movement. Financial calculations in the input are
authoritative. Clearly distinguish confirmed evidence from hypotheses. Never
recommend moving money, issuing a refund, or changing a financial record without
human verification. Draft provider messages as requests for confirmation, not
claims of fault.`;

export async function investigateCase(paymentCase: OperationsCase): Promise<{
  analysis: InvestigationAnalysis;
  provider: "openai" | "deterministic";
  model: string;
}> {
  if (!process.env.OPENAI_API_KEY) {
    return {
      analysis: fallbackInvestigation(paymentCase),
      provider: "deterministic",
      model: "evidence-rules-v1",
    };
  }

  const model = process.env.OPENAI_MODEL ?? "gpt-5.5";
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.parse({
    model,
    instructions,
    input: JSON.stringify({
      caseId: paymentCase.id,
      orderId: paymentCase.orderId,
      gatewayReference: paymentCase.gatewayReference,
      paymentMode: paymentCase.paymentMode,
      orderAmount: paymentCase.orderAmount,
      variance: paymentCase.variance,
      reconciliationStatus: paymentCase.reconciliationStatus,
      summary: paymentCase.summary,
      evidence: paymentCase.evidence,
      analystNotes: paymentCase.notes,
    }),
    reasoning: { effort: "low" },
    text: {
      format: zodTextFormat(InvestigationSchema, "payment_investigation"),
    },
    store: false,
  });

  if (!response.output_parsed) {
    throw new Error("The model did not return a structured investigation.");
  }

  return { analysis: response.output_parsed, provider: "openai", model };
}

export function fallbackInvestigation(
  paymentCase: OperationsCase,
): InvestigationAnalysis {
  const order = paymentCase.orderId;
  const causeByStatus = {
    amount_mismatch:
      "The settlement amount differs from the deterministic expected-net calculation. The current evidence does not identify whether the cause is a fee, adjustment, or reporting issue.",
    duplicate:
      "The gateway report contains more than one transaction row for the same merchant order ID. This may be duplicate reporting or duplicate processing and requires provider confirmation.",
    gateway_missing:
      "The merchant order exists, but the uploaded gateway report has no matching transaction. This may indicate an identifier mismatch, an incomplete export, or a payment that did not reach the gateway.",
    missing_settlement:
      "The gateway shows a successful payment, but the uploaded bank settlement report has no matching settlement. Settlement timing or a missing report row must be checked.",
    matched: "The records agree and no investigation is required.",
    pending:
      "The gateway status is not final. Reconciliation should be repeated after processing completes.",
  } satisfies Record<OperationsCase["reconciliationStatus"], string>;

  return {
    likelyCause: causeByStatus[paymentCase.reconciliationStatus],
    confidence: "medium",
    supportingEvidence: paymentCase.evidence,
    recommendedActions: [
      "Confirm that all three source reports cover the same date and settlement cycle.",
      "Ask the payment provider to verify the gateway reference and settlement calculation.",
      "Record the provider response before changing any financial record.",
    ],
    providerMessage: `Hello Payments Support,\n\nPlease help us verify ${order} (${paymentCase.gatewayReference}). Our reconciliation identified: ${paymentCase.summary}\n\nEvidence:\n${paymentCase.evidence.map((item) => `- ${item}`).join("\n")}\n\nPlease confirm the transaction status, settlement calculation, and any fee or adjustment involved. No financial action has been taken pending your confirmation.\n\nThank you.`,
    limitations: [
      "This analysis uses only the uploaded reports and analyst notes.",
      "It cannot confirm provider-side events or settlement policies.",
    ],
  };
}
