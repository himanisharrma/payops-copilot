import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { SettlementImportDesk } from "@/components/settlement-import-desk";
import { auth } from "@/auth";
import {
  getSettlementImportDetail,
  loadSettlementImportWorkspace,
} from "@/lib/modules/settlement-imports/service";

function readString(
  params: Record<string, string | string[] | undefined>,
  key: string,
) {
  const value = params[key];
  return typeof value === "string" ? value : "";
}

export default async function SettlementImportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  const resolved = await searchParams;
  const params = new URLSearchParams();
  for (const key of [
    "provider",
    "status",
    "exceptionType",
    "adjustmentState",
    "linkedCase",
  ]) {
    const value = readString(resolved, key);
    if (value) params.set(key, value);
  }
  const workspace = await loadSettlementImportWorkspace(
    session.user.organizationId,
    params,
  );
  const selectedId = readString(resolved, "importId") || workspace.imports[0]?.id;
  const selected = selectedId
    ? await getSettlementImportDetail(selectedId, session.user.organizationId)
    : null;
  return (
    <main className="shell">
      <AppHeader active="imports" />
      <SettlementImportDesk
        actorRole={session.user.role}
        workspace={workspace}
        selected={selected}
      />
    </main>
  );
}
