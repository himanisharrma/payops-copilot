import { NextResponse } from "next/server";
import { listRuns } from "@/lib/repository";
import { accessErrorResponse, requireActor } from "@/lib/access";

export async function GET() {
  try {
    const actor = await requireActor();
    return NextResponse.json({ runs: await listRuns(actor.organizationId) });
  } catch (error) {
    const accessResponse = accessErrorResponse(error);
    if (accessResponse) return accessResponse;
    console.error(error);
    return NextResponse.json(
      { error: "Run history is unavailable." },
      { status: 503 },
    );
  }
}
