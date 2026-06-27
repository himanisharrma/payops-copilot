import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/access";
import { apiErrorResponse } from "@/lib/api-errors";
import { DomainError } from "@/lib/modules/errors";
import {
  getManualMatchForItem,
  proposeManualMatch,
} from "@/lib/modules/manual-matches/service";
import { proposeManualMatchInput } from "@/lib/modules/manual-matches/schema";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    const { id } = await params;
    const body = await request.json();
    const parsed = proposeManualMatchInput.safeParse(body);
    if (!parsed.success) {
      throw new DomainError(
        parsed.error.issues[0]?.message ?? "Invalid manual match request.",
        400,
      );
    }
    const result = await proposeManualMatch({
      actor,
      itemId: id,
      reason: parsed.data.reason,
      evidenceConfirmed: parsed.data.evidenceConfirmed,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Manual match could not be applied.");
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor(["admin", "analyst", "viewer"]);
    const { id } = await params;
    return NextResponse.json(await getManualMatchForItem(actor, id));
  } catch (error) {
    return apiErrorResponse(error, "Manual override history could not be loaded.");
  }
}
