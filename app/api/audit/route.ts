import { NextResponse } from "next/server";
import { accessErrorResponse, requireActor } from "@/lib/access";
import { listAuditEvents } from "@/lib/repository";

export async function GET() {
  try {
    const actor = await requireActor(["admin"]);
    return NextResponse.json({
      events: await listAuditEvents(actor.organizationId),
    });
  } catch (error) {
    const accessResponse = accessErrorResponse(error);
    if (accessResponse) return accessResponse;
    return NextResponse.json({ error: "Audit log unavailable." }, { status: 503 });
  }
}
