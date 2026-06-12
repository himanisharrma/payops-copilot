import { AppHeader } from "@/components/app-header";
import { RunHistory } from "@/components/run-history";

export default function RunsPage() {
  return (
    <main className="shell">
      <AppHeader active="runs" />
      <RunHistory />
    </main>
  );
}
