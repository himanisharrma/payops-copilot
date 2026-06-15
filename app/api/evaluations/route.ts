import { NextResponse } from "next/server";
import OpenAI from "openai";
import { accessErrorResponse, requireActor } from "@/lib/access";
import {
  executeEvaluation,
  parseEvaluationProvider,
} from "@/lib/modules/evaluations/service";
import {
  listEvaluationRuns,
} from "@/lib/modules/evaluations/repository";
import { DomainError } from "@/lib/modules/errors";

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
      provider?: unknown;
    };
    return NextResponse.json(
      {
        runs: await executeEvaluation(
          parseEvaluationProvider(payload.provider),
          actor,
        ),
      },
      { status: 201 },
    );
  } catch (error) {
    const accessResponse = accessErrorResponse(error);
    if (accessResponse) return accessResponse;
    if (error instanceof DomainError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    if (
      error instanceof OpenAI.APIError &&
      error.code === "insufficient_quota"
    ) {
      return NextResponse.json(
        {
          error:
            "OpenAI rejected the evaluation because this API project has no available quota. Add API billing or credits, then run it again.",
        },
        { status: 429 },
      );
    }
    console.error(error);
    return NextResponse.json(
      { error: "The evaluation run could not be saved." },
      { status: 503 },
    );
  }
}
