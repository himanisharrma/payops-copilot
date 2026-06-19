import { NextResponse } from "next/server";
import { requireActor } from "@/lib/access";
import { apiErrorResponse } from "@/lib/api-errors";
import { getOperationalNotifications } from "@/lib/modules/notifications/service";

export async function GET() {
  try {
    const actor = await requireActor();
    return NextResponse.json({
      notifications: await getOperationalNotifications(actor),
    });
  } catch (error) {
    return apiErrorResponse(
      error,
      "Operational notifications are unavailable.",
    );
  }
}
