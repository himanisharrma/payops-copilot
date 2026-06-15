import { NextResponse } from "next/server";
import { accessErrorResponse, requireActor } from "@/lib/access";
import { listPaymentWorkflows } from "@/lib/repository";

export async function GET() {
  try {
    const actor = await requireActor();
    return NextResponse.json({
      workflows: await listPaymentWorkflows(actor.organizationId),
    });
  } catch (error) {
    const accessResponse = accessErrorResponse(error);
    if (accessResponse) return accessResponse;
    console.error(error);
    return NextResponse.json(
      { error: "Refund and chargeback workflows are unavailable." },
      { status: 503 },
    );
  }
}
