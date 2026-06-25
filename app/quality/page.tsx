import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppHeader } from "@/components/app-header";
import { QualityLab } from "@/components/quality-lab";
import { paymentInvestigationDataset } from "@/evals/payment-investigations-v1";
import {
  runDeterministicEvaluation,
  summarizeEvaluationScenarios,
} from "@/lib/evaluation";
import { listEvaluationRuns } from "@/lib/modules/evaluations/repository";

export default async function QualityPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const runs = await listEvaluationRuns(session.user.organizationId);
  const baseline = runDeterministicEvaluation(paymentInvestigationDataset);
  return (
    <main className="shell">
      <AppHeader active="quality" />
      <QualityLab
        initialRuns={runs}
        canRun={session.user.role !== "viewer"}
        actor={{
          id: session.user.id,
          name: session.user.name ?? "Unknown user",
          role: session.user.role,
        }}
        baseline={baseline}
        scenarioResults={summarizeEvaluationScenarios(baseline.results)}
        openAIConfigured={Boolean(process.env.OPENAI_API_KEY)}
      />
    </main>
  );
}
