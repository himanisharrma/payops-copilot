import { AppHeader } from "@/components/app-header";
import { OperationsInbox } from "@/components/operations-inbox";

export default function OperationsPage() {
  return (
    <main className="shell">
      <AppHeader active="operations" />
      <OperationsInbox />
    </main>
  );
}
