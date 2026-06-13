import { NextResponse } from "next/server";
import { listCases } from "@/lib/repository";
import { accessErrorResponse, requireActor } from "@/lib/access";

export async function GET() {
  try {
    const actor = await requireActor();
    return NextResponse.json({ cases: await listCases(actor.organizationId) });
  } catch (error) {
    const accessResponse = accessErrorResponse(error);
    if (accessResponse) return accessResponse;
    console.error(error);
    return NextResponse.json(
      { error: "Operations cases are unavailable." },
      { status: 503 },
    );
  }
}
