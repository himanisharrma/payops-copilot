import { AppHeader } from "@/components/app-header";
import { RunHistory } from "@/components/run-history";

export default async function RunsPage() {
  if (!(await auth())) redirect("/login");
  return (
    <main className="shell">
      <AppHeader active="runs" />
      <RunHistory />
    </main>
  );
}
import { redirect } from "next/navigation";
import { auth } from "@/auth";
