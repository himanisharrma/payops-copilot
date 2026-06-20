import { providerIds } from "@/lib/provider-adapters";
import type {
  InsightsFilters,
  InsightsRange,
  OperationsFilters,
  OperationsCase,
  ProviderId,
  ReconciliationStatus,
} from "@/lib/types";

export const insightsRanges: InsightsRange[] = ["7d", "30d", "90d"];
export const insightsPriorities: Array<OperationsCase["priority"] | "all"> = [
  "all",
  "low",
  "medium",
  "high",
];
export const actionableStatuses: ReconciliationStatus[] = [
  "amount_mismatch",
  "missing_settlement",
  "gateway_missing",
  "duplicate",
];

export function parseInsightsFilters(
  searchParams: URLSearchParams,
): InsightsFilters {
  const rangeValue = searchParams.get("range");
  const providerValue = searchParams.get("provider");
  const paymentModeValue = searchParams.get("paymentMode")?.trim();
  const priorityValue = searchParams.get("priority");
  return {
    range: insightsRanges.includes(rangeValue as InsightsRange)
      ? (rangeValue as InsightsRange)
      : "30d",
    provider:
      providerValue === "all" ||
      providerIds.includes(providerValue as ProviderId)
        ? ((providerValue ?? "all") as InsightsFilters["provider"])
        : "all",
    paymentMode: paymentModeValue || "all",
    priority: insightsPriorities.includes(
      priorityValue as InsightsFilters["priority"],
    )
      ? (priorityValue as InsightsFilters["priority"])
      : "all",
  };
}

export function rangeDays(range: InsightsRange) {
  return Number(range.slice(0, -1));
}

export function metricChange(
  value: number | null,
  previousValue: number | null,
) {
  if (value === null || previousValue === null || previousValue === 0) {
    return null;
  }
  return Number((((value - previousValue) / previousValue) * 100).toFixed(1));
}

export function operationsDrilldown(
  filters: Record<string, string | number | null | undefined>,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "" && value !== "all") {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return query ? `/operations?${query}` : "/operations";
}

export function parseOperationsFilters(
  searchParams: URLSearchParams,
): OperationsFilters {
  const statuses = ["all", "open", "investigating", "resolved"];
  const slaValues = ["all", "at_risk", "overdue"];
  const exceptions = [
    "all",
    "matched",
    "amount_mismatch",
    "missing_settlement",
    "gateway_missing",
    "duplicate",
    "pending",
  ];
  const priorities = ["all", "low", "medium", "high"];
  const owners = ["all", "assigned", "unassigned"];
  const ages = ["all", "under_4h", "4h_24h", "1d_3d", "over_3d"];
  const provider = searchParams.get("provider");
  return {
    status: statuses.includes(searchParams.get("status") ?? "")
      ? (searchParams.get("status") as OperationsFilters["status"])
      : "all",
    sla: slaValues.includes(searchParams.get("sla") ?? "")
      ? (searchParams.get("sla") as OperationsFilters["sla"])
      : "all",
    exception: exceptions.includes(searchParams.get("exception") ?? "")
      ? (searchParams.get("exception") as OperationsFilters["exception"])
      : "all",
    provider:
      provider === "all" || providerIds.includes(provider as ProviderId)
        ? (provider as OperationsFilters["provider"])
        : "all",
    paymentMode: searchParams.get("paymentMode")?.trim() || "all",
    priority: priorities.includes(searchParams.get("priority") ?? "")
      ? (searchParams.get("priority") as OperationsFilters["priority"])
      : "all",
    owner: owners.includes(searchParams.get("owner") ?? "")
      ? (searchParams.get("owner") as OperationsFilters["owner"])
      : "all",
    age: ages.includes(searchParams.get("age") ?? "")
      ? (searchParams.get("age") as OperationsFilters["age"])
      : "all",
    query: searchParams.get("query")?.trim() || "",
    caseId: searchParams.get("caseId")?.trim() || null,
  };
}
