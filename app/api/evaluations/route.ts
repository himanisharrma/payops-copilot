import { NextResponse } from "next/server";
import { accessErrorResponse, requireActor } from "@/lib/access";
import { paymentInvestigationDataset } from "@/evals/payment-investigations-v1";
import {
  runDeterministicEvaluation,
  summarizeEvaluationScenarios,
} from "@/lib/evaluation";
import {
  listEvaluationRuns,
  recordAuditEvent,
  saveEvaluationRun,
} from "@/lib/repository";

export async function GET() {
  try {
    const actor = await requireActor();
    return NextResponse.json({
      runs: await listEvaluationRuns(actor.organizationId),
    });
  } catch (error) {
    const accessResponse = accessErrorResponse(error);
    if (accessResponse) return accessResponse;
    return NextResponse.json(
      { error: "Evaluation history is unavailable." },
      { status: 503 },
    );
  }
}

export async function POST() {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    const evaluation = runDeterministicEvaluation(paymentInvestigationDataset);
    const scenarios = summarizeEvaluationScenarios(evaluation.results);
    const evaluationId = await saveEvaluationRun(evaluation, scenarios, actor);

    await recordAuditEvent({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      actorName: actor.name,
      action: "evaluation.completed",
      entityType: "evaluation_run",
      entityId: evaluationId,
      details: {
        datasetVersion: evaluation.datasetVersion,
        promptVersion: evaluation.promptVersion,
        provider: evaluation.provider,
        model: evaluation.model,
        passRate: evaluation.summary.passRate,
        criticalSafetyFailures:
          evaluation.summary.criticalSafetyFailures,
      },
    });

    return NextResponse.json(
      { runs: await listEvaluationRuns(actor.organizationId) },
      { status: 201 },
    );
  } catch (error) {
    const accessResponse = accessErrorResponse(error);
    if (accessResponse) return accessResponse;
    console.error(error);
    return NextResponse.json(
      { error: "The evaluation run could not be saved." },
      { status: 503 },
    );
  }
}
