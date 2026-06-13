import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppHeader } from "@/components/app-header";
import { AuditLog } from "@/components/audit-log";

export default async function AuditPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/");
  return (
    <main className="shell">
      <AppHeader active="audit" />
      <AuditLog />
    </main>
  );
}
