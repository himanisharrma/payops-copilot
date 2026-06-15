import { NextResponse } from "next/server";
import { accessErrorResponse, requireActor } from "@/lib/access";
import { paymentInvestigationDataset } from "@/evals/payment-investigations-v1";
import {
  runDeterministicEvaluation,
  runOpenAIEvaluation,
  summarizeEvaluationScenarios,
} from "@/lib/evaluation";
import {
  listEvaluationRuns,
  recordAuditEvent,
  saveEvaluationRun,
} from "@/lib/repository";

export const maxDuration = 300;

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

export async function POST(request: Request) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    const payload = (await request.json().catch(() => ({}))) as {
      provider?: "deterministic" | "openai";
    };
    const provider = payload.provider ?? "deterministic";
    if (provider !== "deterministic" && provider !== "openai") {
      return NextResponse.json(
        { error: "Evaluation provider must be deterministic or openai." },
        { status: 400 },
      );
    }
    if (provider === "openai" && !process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        {
          error:
            "OpenAI model evaluation is unavailable until OPENAI_API_KEY is configured.",
        },
        { status: 409 },
      );
    }
    const evaluation =
      provider === "openai"
        ? await runOpenAIEvaluation(paymentInvestigationDataset)
        : runDeterministicEvaluation(paymentInvestigationDataset);
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
        durationMs: evaluation.durationMs,
        totalTokens: evaluation.usage.totalTokens,
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
