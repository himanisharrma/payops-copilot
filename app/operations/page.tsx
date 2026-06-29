import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppHeader } from "@/components/app-header";
import { OperationsInbox } from "@/components/operations-inbox";
import { parseOperationsFilters } from "@/lib/insights";

export default async function OperationsPage({
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
  return (
    <main className="shell">
      <AppHeader active="operations" />
      <OperationsInbox
        canEdit={session.user.role !== "viewer"}
        role={session.user.role}
        userId={session.user.id}
        initialFilters={parseOperationsFilters(params)}
      />
    </main>
  );
}
