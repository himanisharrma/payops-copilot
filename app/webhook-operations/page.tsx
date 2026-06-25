import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppHeader } from "@/components/app-header";
import { WebhookTrustDashboard } from "@/components/webhook-trust-dashboard";
import { getProviderWebhookObservability } from "@/lib/modules/provider-events/repository";

export default async function WebhookOperationsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/");
  const observability = await getProviderWebhookObservability(
    session.user.organizationId,
  );
  return (
    <main className="shell">
      <AppHeader active="webhooks" />
      <WebhookTrustDashboard observability={observability} />
    </main>
  );
}
