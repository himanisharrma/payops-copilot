import { parseInsightsFilters } from "@/lib/insights";
import { getInsightsDashboard } from "@/lib/modules/insights/repository";

export async function loadInsights(
  organizationId: string,
  searchParams: URLSearchParams,
) {
  return getInsightsDashboard(
    organizationId,
    parseInsightsFilters(searchParams),
  );
}
