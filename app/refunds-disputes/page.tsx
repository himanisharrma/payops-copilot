import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppHeader } from "@/components/app-header";
import { PaymentLifecycle } from "@/components/payment-lifecycle";

export default async function RefundsDisputesPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <main className="shell">
      <AppHeader active="payments" />
      <PaymentLifecycle canEdit={session.user.role !== "viewer"} />
    </main>
  );
}
