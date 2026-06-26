import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/access";
import { apiErrorResponse } from "@/lib/api-errors";
import {
  createSettlementImport,
  loadSettlementImportWorkspace,
} from "@/lib/modules/settlement-imports/service";
import type { ProviderId } from "@/lib/types";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireActor();
    return NextResponse.json(
      await loadSettlementImportWorkspace(
        actor.organizationId,
        request.nextUrl.searchParams,
      ),
    );
  } catch (error) {
    return apiErrorResponse(error, "Settlement imports could not be loaded.");
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    const formData = await request.formData();
    const providerId = String(formData.get("providerId") ?? "generic") as ProviderId;
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "CSV file is required." }, { status: 400 });
    }
    return NextResponse.json(
      await createSettlementImport({
        actor,
        providerId,
        filename: file.name,
        csvText: await file.text(),
      }),
    );
  } catch (error) {
    return apiErrorResponse(error, "Settlement import could not be created.");
  }
}
