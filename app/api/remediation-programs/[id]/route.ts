import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/access";
import { apiErrorResponse } from "@/lib/api-errors";
import { getRemediationProgram } from "@/lib/modules/remediation-programs/repository";
import { changeRemediationProgram } from "@/lib/modules/remediation-programs/service";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    const program = await getRemediationProgram(id, actor.organizationId);
    if (!program) {
      return NextResponse.json(
        { error: "Remediation program not found." },
        { status: 404 },
      );
    }
    return NextResponse.json(program);
  } catch (error) {
    return apiErrorResponse(
      error,
      "The remediation program could not be loaded.",
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    const { id } = await context.params;
    return NextResponse.json(
      await changeRemediationProgram(id, await request.json(), actor),
    );
  } catch (error) {
    return apiErrorResponse(
      error,
      "The remediation program could not be updated.",
    );
  }
}
