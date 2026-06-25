import { NextResponse } from "next/server";
import { requireActor } from "@/lib/access";
import { apiErrorResponse } from "@/lib/api-errors";
import { DomainError } from "@/lib/modules/errors";
import { readOperationalNotification } from "@/lib/modules/notifications/service";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    const body = await request.json().catch(() => null);
    if (
      !body ||
      typeof body !== "object" ||
      !("read" in body) ||
      body.read !== true
    ) {
      throw new DomainError("Notification read confirmation is required.", 400);
    }
    const { id } = await context.params;
    await readOperationalNotification(id, actor);
    return NextResponse.json({ updated: true });
  } catch (error) {
    return apiErrorResponse(error, "The notification could not be updated.");
  }
}
