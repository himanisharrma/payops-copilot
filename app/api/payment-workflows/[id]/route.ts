import { NextResponse } from "next/server";
import { accessErrorResponse, requireActor } from "@/lib/access";
import {
  changePaymentWorkflow,
  type PaymentWorkflowPatch,
} from "@/lib/modules/payment-workflows/service";
import { DomainError } from "@/lib/modules/errors";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    const { id } = await context.params;
    const payload = (await request.json()) as PaymentWorkflowPatch;
    return NextResponse.json({
      workflow: await changePaymentWorkflow(id, payload, actor),
    });
  } catch (error) {
    const accessResponse = accessErrorResponse(error);
    if (accessResponse) return accessResponse;
    if (error instanceof DomainError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error(error);
    return NextResponse.json(
      { error: "The payment workflow could not be updated." },
      { status: 503 },
    );
  }
}
