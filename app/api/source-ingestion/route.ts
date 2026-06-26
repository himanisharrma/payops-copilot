import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/access";
import { apiErrorResponse } from "@/lib/api-errors";
import {
  loadSourceIngestionControlPlane,
  registerSourceExpectation,
  uploadSourceFile,
} from "@/lib/modules/source-ingestion/service";
import type {
  SourceIngestionProviderId,
  SourceKind,
  SourceTransportType,
} from "@/lib/modules/source-ingestion/types";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireActor();
    return NextResponse.json(
      await loadSourceIngestionControlPlane(
        actor.organizationId,
        request.nextUrl.searchParams,
      ),
    );
  } catch (error) {
    return apiErrorResponse(error, "Source ingestion could not be loaded.");
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireActor(["admin", "analyst"]);
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "CSV file is required." }, { status: 400 });
      }
      return NextResponse.json(
        await uploadSourceFile({
          actor,
          expectationId: String(formData.get("expectationId") ?? ""),
          filename: file.name,
          csvText: await file.text(),
        }),
      );
    }

    const body = await request.json();
    return NextResponse.json(
      await registerSourceExpectation({
        actor,
        sourceKey: String(body.sourceKey ?? ""),
        displayName: String(body.displayName ?? ""),
        providerId: String(body.providerId ?? "generic") as SourceIngestionProviderId,
        sourceKind: String(body.sourceKind ?? "gateway_report") as SourceKind,
        transportType: String(body.transportType ?? "manual_upload") as SourceTransportType,
        businessDate: String(body.businessDate ?? ""),
        expectedArrivalAt: String(body.expectedArrivalAt ?? ""),
        graceMinutes: Number(body.graceMinutes ?? 60),
        requiredForClose: Boolean(body.requiredForClose ?? true),
        expectedFilenamePattern: String(body.expectedFilenamePattern ?? "*.csv"),
        ownerTeam: String(body.ownerTeam ?? "Payment operations"),
      }),
    );
  } catch (error) {
    return apiErrorResponse(error, "Source ingestion mutation failed.");
  }
}
