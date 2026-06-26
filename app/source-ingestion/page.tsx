import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { SourceIngestionControlPlane } from "@/components/source-ingestion-control-plane";
import { auth } from "@/auth";
import { loadSourceIngestionControlPlane } from "@/lib/modules/source-ingestion/service";

function readString(
  params: Record<string, string | string[] | undefined>,
  key: string,
) {
  const value = params[key];
  return typeof value === "string" ? value : "";
}

export default async function SourceIngestionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  const resolved = await searchParams;
  const params = new URLSearchParams();
  const businessDate = readString(resolved, "businessDate");
  if (businessDate) params.set("businessDate", businessDate);
  const workspace = await loadSourceIngestionControlPlane(
    session.user.organizationId,
    params,
  );
  return (
    <main className="shell">
      <AppHeader active="sources" />
      <SourceIngestionControlPlane
        actorRole={session.user.role}
        workspace={workspace}
      />
    </main>
  );
}
