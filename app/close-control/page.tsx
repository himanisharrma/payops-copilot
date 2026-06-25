import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppHeader } from "@/components/app-header";
import { ReconciliationCloseControl } from "@/components/reconciliation-close-control";
import { loadCloseWorkspace } from "@/lib/modules/close-control/service";

export default async function CloseControlPage({
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
  const workspace = await loadCloseWorkspace(
    session.user.organizationId,
    params,
  );
  return (
    <main className="shell">
      <AppHeader active="close" />
      <ReconciliationCloseControl
        initialWorkspace={workspace}
        actor={{
          name: session.user.name ?? "Unknown user",
          role: session.user.role,
        }}
      />
    </main>
  );
}
