import { NextResponse } from "next/server";
import { requireActor } from "@/lib/access";
import { apiErrorResponse } from "@/lib/api-errors";
import {
  decideSourceIngestionVersion,
  loadSourceIngestionVersion,
} from "@/lib/modules/source-ingestion/service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const detail = await loadSourceIngestionVersion(id, actor.organizationId);
    if (!detail) {
      return NextResponse.json({ error: "Source version not found." }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (error) {
    return apiErrorResponse(error, "Source version could not be loaded.");
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    const { id } = await params;
    const body = await request.json();
    await decideSourceIngestionVersion({
      actor,
      arrivalId: id,
      action: body.action,
      reason: String(body.reason ?? ""),
    });
    return NextResponse.json(await loadSourceIngestionVersion(id, actor.organizationId));
  } catch (error) {
    return apiErrorResponse(error, "Source version review failed.");
  }
}
