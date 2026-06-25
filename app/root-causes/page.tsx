import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppHeader } from "@/components/app-header";
import { RecurrenceControlBoard } from "@/components/recurrence-control-board";
import { loadRemediationWorkspace } from "@/lib/modules/remediation-programs/service";

export default async function RootCausesPage({
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
  const workspace = await loadRemediationWorkspace(
    session.user.organizationId,
    params,
  );
  return (
    <main className="shell">
      <AppHeader active="root-causes" />
      <RecurrenceControlBoard
        workspace={workspace}
        role={session.user.role}
      />
    </main>
  );
}
