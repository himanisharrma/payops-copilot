import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppHeader } from "@/components/app-header";
import { OperationsInsights } from "@/components/operations-insights";
import { loadInsights } from "@/lib/modules/insights/service";

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  const resolved = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value === "string") params.set(key, value);
  }
  const dashboard = await loadInsights(
    session.user.organizationId,
    params,
  );
  return (
    <main className="shell">
      <AppHeader active="insights" />
      <OperationsInsights dashboard={dashboard} />
    </main>
  );
}
