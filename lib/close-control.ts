import { createHash } from "node:crypto";
import type {
  ProviderId,
  ReconciliationCloseReadiness,
} from "@/lib/types";

const providers = new Set<ProviderId>([
  "generic",
  "razorpay_demo",
  "cashfree_demo",
  "payu_demo",
]);

export function validBusinessDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
}

export function parseCloseFilters(input: URLSearchParams) {
  const date = input.get("date") ?? indiaBusinessDate(new Date());
  const provider = input.get("provider") ?? "generic";
  const paymentMode = (input.get("paymentMode") ?? "UPI").trim();
  return {
    businessDate: validBusinessDate(date)
      ? date
      : indiaBusinessDate(new Date()),
    providerId: providers.has(provider as ProviderId)
      ? (provider as ProviderId)
      : "generic",
    paymentMode: paymentMode.slice(0, 80) || "UPI",
  };
}

export function indiaBusinessDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function closeBlockers(input: Omit<
  ReconciliationCloseReadiness,
  "ready" | "blockers"
>) {
  const blockers: string[] = [];
  if (input.runCount === 0) {
    blockers.push("No completed reconciliation run exists for this scope.");
  }
  if (input.blockingCaseCount > 0) {
    blockers.push(
      `${input.blockingCaseCount} high-priority exception${input.blockingCaseCount === 1 ? "" : "s"} ${input.blockingCaseCount === 1 ? "remains" : "remain"} unresolved.`,
    );
  }
  if (input.unresolvedCaseCount > input.unresolvedCountThreshold) {
    blockers.push(
      `Unresolved case count exceeds the threshold of ${input.unresolvedCountThreshold}.`,
    );
  }
  if (input.unresolvedExposure > input.unresolvedAmountThreshold) {
    blockers.push(
      `Unresolved exposure exceeds the threshold of ₹${input.unresolvedAmountThreshold.toFixed(2)}.`,
    );
  }
  return blockers;
}

export function withCloseReadiness(
  input: Omit<ReconciliationCloseReadiness, "ready" | "blockers">,
): ReconciliationCloseReadiness {
  const blockers = closeBlockers(input);
  return { ...input, ready: blockers.length === 0, blockers };
}

export function stableSnapshotHash(value: unknown) {
  return createHash("sha256")
    .update(stableJson(value))
    .digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
