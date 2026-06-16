import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-errors";
import { requireActor } from "@/lib/access";
import {
  changePaymentWorkflow,
  type PaymentWorkflowPatch,
} from "@/lib/modules/payment-workflows/service";

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
    return apiErrorResponse(
      error,
      "The payment workflow could not be updated.",
    );
  }
}
