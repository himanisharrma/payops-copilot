import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppHeader } from "@/components/app-header";
import { QualityLab } from "@/components/quality-lab";

export default async function QualityPage() {
  const session = await auth();
  if (!session) redirect("/login");
  return (
    <main className="shell">
      <AppHeader active="quality" />
      <QualityLab />
    </main>
  );
}
